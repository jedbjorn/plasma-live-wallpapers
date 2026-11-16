package com.designsos.livescenes;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Handler;
import android.os.HandlerThread;
import android.hardware.display.DisplayManager;
import android.os.Process;
import android.util.Log;
import android.view.Choreographer;
import android.view.Display;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Plays one video file in an endless, seamless loop onto a Surface, with hardware decoding.
 *
 * Looping: when the extractor reaches the end it seeks back to the start and keeps feeding the same decoder,
 * with timestamps that keep counting up (+ one period per lap). The decoder is never flushed or restarted,
 * so the first frame follows the last one exactly like any other frame (the stream starts with an IDR frame).
 *
 * Output: if the video has the surface's aspect ratio (within 1 %), or the surface can crop (a SurfaceView-like
 * surface, {@code surfaceCrops}) and the focus point asks for the centre crop, the decoder renders straight into
 * the surface and the compositor scales and crops it: no GL, no copies. Otherwise frames go through a
 * SurfaceTexture and {@link GlCrop} draws the aspect-fill crop around the focus point (costs ~5 ms of CPU per
 * frame in the GPU driver on a Pixel 6, so it's only for off-centre crops).
 *
 * Timing: each decoded frame is released ~LEAD before its due time, with that time as the buffer's present
 * time, so the compositor shows it on the right vsync. The codec is used synchronously from one private
 * thread that wakes once per frame (top up input, collect output, release what's due, sleep).
 * Paused = no more releases: the decoder fills its buffers and stops; nothing runs until it resumes.
 * The public methods only post to that thread (release() waits).
 */
final class VideoLoop {
    static final String TAG = LiveWallpaperService.TAG;
    static final long LEAD_NS = 25_000_000;          // release a frame this long before it is due
    static final long LATE_NS = 150_000_000;         // later than this (e.g. after a stall): restart the clock
    static final long POLL_MS = 5;                   // waiting for the decoder (start-up only, normally)
    static final long ALIGN_NS = 2_000_000_000L;     // how often the clock is re-centred between vsyncs

    interface Listener { void onFailed(Exception e); }

    final Context ctx;
    final Store.Video video;
    final Surface window;
    final int winW, winH;
    final boolean surfaceCrops;
    final Listener listener;
    final HandlerThread thread;
    final Handler h;

    // all below: only on the thread
    MediaExtractor ex;
    MediaCodec codec;
    GlCrop gl;
    boolean released, paused, primed, inputDone;
    float speed;
    long lapUs;                                // offset added to the file's timestamps: laps * period
    long periodUs;                             // the video's length, known after the first lap
    long minPts = Long.MAX_VALUE, maxPts = Long.MIN_VALUE, samples;
    long anchorNs = -1, anchorPts;             // clock: frame anchorPts is shown at anchorNs
    long lastNs, lastPts;
    long laps;
    long nextSeamPts;                          // first frame of the next lap (for the log)
    final ArrayDeque<long[]> ready = new ArrayDeque<>();   // decoded frames waiting for their time: {index, pts}
    final MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
    Choreographer choreographer;
    Display display;
    boolean aligning;
    long alignedAt;
    final Runnable tick = this::tick;

    VideoLoop(Context ctx, Store.Video video, Surface window, int winW, int winH, boolean paused,
              boolean surfaceCrops, Listener listener) {
        this.ctx = ctx;
        this.video = video;
        this.window = window;
        this.winW = winW;
        this.winH = winH;
        this.paused = paused;
        this.surfaceCrops = surfaceCrops;
        this.speed = video.speed;
        this.listener = listener;
        thread = new HandlerThread("LiveScenes-video", Process.THREAD_PRIORITY_DISPLAY);
        thread.start();
        h = new Handler(thread.getLooper());
        h.post(this::open);
    }

    // ---- public: called from any thread

    void setPaused(boolean p) { h.post(() -> { if (paused != p) { paused = p; if (!p) anchorNs = -1; tick(); } }); }

    void setSpeed(float s) {
        h.post(() -> {
            if (s == speed) return;
            if (anchorNs >= 0) { anchorNs = lastNs; anchorPts = lastPts; }   // the next frame keeps its place
            speed = s;
            tick();
        });
    }

    /** Redraws the last frame (GL output only: a direct surface keeps its last buffer on its own). */
    void redraw() {
        h.post(() -> {
            try {
                if (gl != null && !released) gl.redraw();
            } catch (RuntimeException e) {
                fail(e);
            }
        });
    }

    /** Stops and frees everything; returns once the surface is no longer used. */
    void release() {
        CountDownLatch done = new CountDownLatch(1);
        h.post(() -> { shutdown(); done.countDown(); });
        try {
            if (!done.await(2, TimeUnit.SECONDS)) Log.w(TAG, "video thread slow to stop");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        thread.quitSafely();
    }

    // ---- the thread

    void open() {
        try {
            ex = new MediaExtractor();
            if (video.file != null) {
                ex.setDataSource(video.file.getPath());
            } else {
                try (AssetFileDescriptor fd = video.openAsset(ctx)) {
                    ex.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
                }
            }
            int track = -1;
            MediaFormat f = null;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) { track = i; break; }
            }
            if (track < 0) throw new IllegalStateException("no video track in " + video.key());
            ex.selectTrack(track);
            String mime = f.getString(MediaFormat.KEY_MIME);
            int vw = f.getInteger(MediaFormat.KEY_WIDTH), vh = f.getInteger(MediaFormat.KEY_HEIGHT);
            if (f.containsKey("rotation-degrees") && f.getInteger("rotation-degrees") % 180 != 0) { int t = vw; vw = vh; vh = t; }

            // direct: same aspect ratio, or the compositor's centre crop is the crop the focus point asks for
            float[] crop = GlCrop.crop(vw, vh, winW, winH, video.focusX, video.focusY);
            float[] centre = GlCrop.crop(vw, vh, winW, winH, 0.5f, 0.5f);
            boolean sameAspect = Math.abs(((float) vw / vh) / ((float) winW / winH) - 1f) < 0.01f;
            boolean centred = Math.abs(crop[0] - centre[0]) < 0.005f && Math.abs(crop[1] - centre[1]) < 0.005f;
            boolean direct = sameAspect || (surfaceCrops && centred);
            Surface out = window;
            if (!direct) {
                gl = new GlCrop(window, h);
                gl.setCrop(crop);
                out = gl.input;
            }
            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(f, out, null, 0);
            if (direct) codec.setVideoScalingMode(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING);
            codec.start();
            choreographer = Choreographer.getInstance();   // this thread's
            display = ctx.getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
            tick();
            Log.i(TAG, "playing " + video.look + " " + video.orientation + " " + vw + "x" + vh + " on " + winW + "x" + winH
                    + (direct ? " (direct)" : " (GL crop, focus " + video.focusX + "," + video.focusY + ")")
                    + " with " + codec.getName() + " at " + speed + "x" + (paused ? ", paused" : ""));
        } catch (Exception e) {
            fail(e);
        }
    }

    /**
     * One wakeup per frame: top up the decoder's input, collect decoded frames, release the ones that are due,
     * then sleep until the next is. (Synchronous MediaCodec: no callback hops between threads.)
     */
    void tick() {
        h.removeCallbacks(tick);
        if (released || codec == null) return;
        try {
            while (!inputDone) {
                int i = codec.dequeueInputBuffer(0);
                if (i < 0) break;
                feed(codec, i);
            }
            for (;;) {
                int o = codec.dequeueOutputBuffer(info, 0);
                if (o >= 0) {
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) codec.releaseOutputBuffer(o, false);
                    else ready.add(new long[]{o, info.presentationTimeUs});
                } else if (o == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    break;
                }   // else: format or buffers changed, nothing to do for surface output
            }
            long wait = pumpFrames();
            if (wait >= 0) h.postDelayed(tick, wait);
            else if (ready.isEmpty() && !inputDone && (!paused || !primed)) h.postDelayed(tick, POLL_MS);   // decoder busy
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    void feed(MediaCodec c, int index) {
        ByteBuffer b = c.getInputBuffer(index);
        int n = ex.readSampleData(b, 0);
        if (n < 0) {
            // end of the file: go round again, timestamps continuing one period later
            if (periodUs == 0) {
                if (samples < 2) { inputDone = true; c.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); return; }
                periodUs = (maxPts - minPts) * samples / (samples - 1);   // n frames at a constant rate
            }
            ex.seekTo(0, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
            lapUs += periodUs;
            laps++;
            n = ex.readSampleData(b, 0);
            if (n < 0) { inputDone = true; c.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); return; }
        }
        long t = ex.getSampleTime();
        if (periodUs == 0) { minPts = Math.min(minPts, t); maxPts = Math.max(maxPts, t); samples++; }
        c.queueInputBuffer(index, 0, n, t + lapUs, 0);
        ex.advance();
    }

    /**
     * Releases the frames that are due (or nearly). Returns the ms to sleep until the next one is,
     * or -1 if there is none decoded yet or it's paused.
     */
    long pumpFrames() {
        while (!ready.isEmpty()) {
            long[] f = ready.peek();
            long now = System.nanoTime();
            if (!primed) {
                // the first frame shows at once, even paused, so the surface isn't left empty
                primed = true;
                anchorNs = -1;
            } else if (paused) {
                return -1;
            }
            if (anchorNs < 0) { anchorNs = now; anchorPts = f[1]; }
            long due = anchorNs + (long) ((f[1] - anchorPts) * 1000 / speed);
            if (due - now > LEAD_NS) return Math.max(1, (due - now - LEAD_NS) / 1_000_000);
            if (now - due > LATE_NS) { anchorNs = now; anchorPts = f[1]; due = now; }
            ready.poll();
            codec.releaseOutputBuffer((int) f[0], due);
            if (periodUs > 0 && f[1] >= nextSeamPts) {
                if (nextSeamPts > 0 && Log.isLoggable(TAG, Log.DEBUG)) Log.d(TAG, "seam: lap " + (f[1] - minPts) / periodUs + " starts, due " + due / 1000 + " us");
                nextSeamPts = minPts + ((f[1] - minPts) / periodUs + 1) * periodUs;
            }
            lastNs = due;
            lastPts = f[1];
            if (paused) anchorNs = -1;   // the primed frame: the clock starts at resume
            else if (now - alignedAt > ALIGN_NS) requestAlign();
        }
        return -1;
    }

    /**
     * Keeps the due times halfway between two vsyncs. The compositor shows a buffer at the first vsync at or
     * after its present time; a time right on a vsync flips between two of them (17/50 ms judder), and the
     * video clock drifts against the display's, so this is redone every couple of seconds.
     */
    void requestAlign() {
        if (aligning || choreographer == null) return;
        aligning = true;
        alignedAt = System.nanoTime();
        choreographer.postFrameCallback(vsyncNs -> {
            aligning = false;
            if (released || anchorNs < 0 || display == null) return;
            long period = (long) (1e9 / display.getRefreshRate());
            long hwVsync = vsyncNs - display.getAppVsyncOffsetNanos();
            long phase = Math.floorMod(anchorNs - hwVsync, period);
            long shift = period / 2 - phase;                     // within half a vsync either way
            anchorNs += shift;
            lastNs += shift;
        });
    }

    void fail(Exception e) {
        if (released) return;
        Log.e(TAG, "video failed: " + video.key(), e);
        shutdown();
        if (listener != null) listener.onFailed(e);
    }

    void shutdown() {
        if (released) return;
        released = true;
        h.removeCallbacksAndMessages(null);
        choreographer = null;
        ready.clear();
        try {
            if (codec != null) {
                try { codec.stop(); } catch (RuntimeException ignored) {}
                codec.release();
            }
            if (ex != null) ex.release();
            if (gl != null) gl.release();
        } catch (RuntimeException e) {
            Log.w(TAG, "release", e);
        }
        codec = null;
        ex = null;
        gl = null;
        if (laps > 0) Log.i(TAG, "stopped " + video.look + " after " + laps + " laps");
    }
}
