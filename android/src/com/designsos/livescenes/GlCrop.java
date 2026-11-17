package com.designsos.livescenes;

import android.graphics.Bitmap;
import android.graphics.SurfaceTexture;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.os.Handler;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * Draws decoded frames (a SurfaceTexture) to a window as an aspect-fill crop around a focus point:
 * one textured quad per decoded frame, nothing in between. Used only when the video's aspect ratio
 * differs from the surface's (e.g. a landscape-only look on a phone); lives on the video thread.
 * Also draws the low-battery still ({@link #drawStill}).
 */
final class GlCrop implements SurfaceTexture.OnFrameAvailableListener {
    static final String VS =
            "attribute vec2 aPos;\n"
          + "uniform mat4 uSt;\n"
          + "uniform vec4 uCrop;\n"
          + "varying vec2 vTc;\n"
          + "void main() {\n"
          + "  vec2 uv = aPos * 0.5 + 0.5;\n"
          + "  vTc = (uSt * vec4(uCrop.xy + uv * uCrop.zw, 0.0, 1.0)).xy;\n"
          + "  gl_Position = vec4(aPos, 0.0, 1.0);\n"
          + "}\n";
    static final String FS =
            "#extension GL_OES_EGL_image_external : require\n"
          + "precision mediump float;\n"
          + "uniform samplerExternalOES uTex;\n"
          + "varying vec2 vTc;\n"
          + "void main() { gl_FragColor = texture2D(uTex, vTc); }\n";
    static final String FS_2D =
            "precision mediump float;\n"
          + "uniform sampler2D uTex;\n"
          + "varying vec2 vTc;\n"
          + "void main() { gl_FragColor = texture2D(uTex, vTc); }\n";
    /** Bitmap rows run top-down, texture v bottom-up: flip v. */
    static final float[] FLIP_V = {1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1};

    final EGLDisplay dpy;
    final EGLContext ctx;
    final EGLSurface win;
    final int prog, tex, aPos, uSt, uCrop;
    final SurfaceTexture st;
    final Surface input;
    final float[] mtx = new float[16];
    final float[] crop = {0, 0, 1, 1};
    final FloatBuffer quad;
    boolean hasFrame;

    GlCrop(Surface window, Handler h) {
        dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] v = new int[2];
        if (!EGL14.eglInitialize(dpy, v, 0, v, 1)) throw new IllegalStateException("eglInitialize");
        EGLConfig cfg = config(dpy);
        ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT,
                new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE}, 0);
        win = EGL14.eglCreateWindowSurface(dpy, cfg, window, new int[]{EGL14.EGL_NONE}, 0);
        if (ctx == EGL14.EGL_NO_CONTEXT || win == EGL14.EGL_NO_SURFACE) throw new IllegalStateException("EGL setup failed");
        EGL14.eglMakeCurrent(dpy, win, win, ctx);

        prog = GLES20.glCreateProgram();
        GLES20.glAttachShader(prog, shader(GLES20.GL_VERTEX_SHADER, VS));
        GLES20.glAttachShader(prog, shader(GLES20.GL_FRAGMENT_SHADER, FS));
        GLES20.glLinkProgram(prog);
        aPos = GLES20.glGetAttribLocation(prog, "aPos");
        uSt = GLES20.glGetUniformLocation(prog, "uSt");
        uCrop = GLES20.glGetUniformLocation(prog, "uCrop");
        int[] t = new int[1];
        GLES20.glGenTextures(1, t, 0);
        tex = t[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        quad = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        quad.put(new float[]{-1, -1, 1, -1, -1, 1, 1, 1}).position(0);
        // all state is set once: a frame is just bind-free draw + swap
        int[] vbo = new int[1];
        GLES20.glGenBuffers(1, vbo, 0);
        GLES20.glBindBuffer(GLES20.GL_ARRAY_BUFFER, vbo[0]);
        GLES20.glBufferData(GLES20.GL_ARRAY_BUFFER, 8 * 4, quad, GLES20.GL_STATIC_DRAW);
        GLES20.glUseProgram(prog);
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, 0);
        GLES20.glEnableVertexAttribArray(aPos);
        GLES20.glDisable(GLES20.GL_BLEND);
        GLES20.glDisable(GLES20.GL_DITHER);

        st = new SurfaceTexture(tex);
        st.setOnFrameAvailableListener(this, h);
        input = new Surface(st);
    }

    static EGLConfig config(EGLDisplay dpy) {
        int[] attrs = {EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
                EGL14.EGL_NONE};
        EGLConfig[] cfg = new EGLConfig[1];
        int[] n = new int[1];
        if (!EGL14.eglChooseConfig(dpy, attrs, 0, cfg, 0, 1, n, 0) || n[0] < 1) throw new IllegalStateException("no EGL config");
        return cfg[0];
    }

    /**
     * Draws a bitmap to the window once, cropped like the video ({@link #crop}), then lets go of the window
     * entirely so a decoder can use it later (a Canvas would stay attached to it). Runs on the calling thread.
     */
    static void drawStill(Surface window, Bitmap b, float[] crop) {
        EGLDisplay dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] v = new int[2];
        if (!EGL14.eglInitialize(dpy, v, 0, v, 1)) throw new IllegalStateException("eglInitialize");
        EGLConfig cfg = config(dpy);
        EGLContext ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT,
                new int[]{EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE}, 0);
        EGLSurface win = EGL14.eglCreateWindowSurface(dpy, cfg, window, new int[]{EGL14.EGL_NONE}, 0);
        try {
            if (ctx == EGL14.EGL_NO_CONTEXT || win == EGL14.EGL_NO_SURFACE
                    || !EGL14.eglMakeCurrent(dpy, win, win, ctx)) throw new IllegalStateException("EGL setup failed");
            int prog = GLES20.glCreateProgram();
            GLES20.glAttachShader(prog, shader(GLES20.GL_VERTEX_SHADER, VS));
            GLES20.glAttachShader(prog, shader(GLES20.GL_FRAGMENT_SHADER, FS_2D));
            GLES20.glLinkProgram(prog);
            GLES20.glUseProgram(prog);
            int[] t = new int[1];
            GLES20.glGenTextures(1, t, 0);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0]);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, b, 0);
            FloatBuffer quad = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
            quad.put(new float[]{-1, -1, 1, -1, -1, 1, 1, 1}).position(0);
            int aPos = GLES20.glGetAttribLocation(prog, "aPos");
            GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad);
            GLES20.glEnableVertexAttribArray(aPos);
            GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(prog, "uSt"), 1, false, FLIP_V, 0);
            GLES20.glUniform4fv(GLES20.glGetUniformLocation(prog, "uCrop"), 1, crop, 0);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
            if (!EGL14.eglSwapBuffers(dpy, win)) throw new IllegalStateException("eglSwapBuffers 0x" + Integer.toHexString(EGL14.eglGetError()));
        } finally {
            EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
            if (win != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, win);   // disconnects from the window
            if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(dpy, ctx);
            EGL14.eglReleaseThread();
        }
    }

    /**
     * Aspect fill: the visible part of the video, moved so the focus point is as central as the edges allow.
     * Returns {x0, y0, width, height} in texture coordinates (fractions; y from the bottom).
     */
    static float[] crop(int vw, int vh, int ww, int wh, float fx, float fy) {
        float s = Math.max((float) ww / vw, (float) wh / vh);
        float w = ww / (vw * s), hh = wh / (vh * s);           // visible fraction of the video
        float x0 = clamp(fx - w / 2, 0, 1 - w);
        float top = clamp(fy - hh / 2, 0, 1 - hh);              // focus y counts from the top; texture v from the bottom
        return new float[]{x0, 1 - top - hh, w, hh};
    }

    void setCrop(float[] c) { System.arraycopy(c, 0, crop, 0, 4); }

    @Override
    public void onFrameAvailable(SurfaceTexture t) {
        if (released) return;
        try {
            frame();
        } catch (RuntimeException e) {
            android.util.Log.w(LiveWallpaperService.TAG, "GL frame", e);
        }
    }

    void frame() {
        st.updateTexImage();
        st.getTransformMatrix(mtx);
        hasFrame = true;
        draw();
        EGLExt.eglPresentationTimeANDROID(dpy, win, st.getTimestamp());
        EGL14.eglSwapBuffers(dpy, win);
    }

    void redraw() {
        if (!hasFrame) return;
        draw();
        EGL14.eglSwapBuffers(dpy, win);
    }

    final float[] sentMtx = new float[16];
    boolean sent;

    void draw() {
        if (!sent || !java.util.Arrays.equals(mtx, sentMtx)) {   // the transform rarely changes
            GLES20.glUniformMatrix4fv(uSt, 1, false, mtx, 0);
            GLES20.glUniform4fv(uCrop, 1, crop, 0);
            System.arraycopy(mtx, 0, sentMtx, 0, 16);
            sent = true;
        }
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }

    boolean released;

    void release() {
        released = true;
        st.setOnFrameAvailableListener(null);
        input.release();
        st.release();
        EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
        EGL14.eglDestroySurface(dpy, win);
        EGL14.eglDestroyContext(dpy, ctx);
        EGL14.eglReleaseThread();
    }

    static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        int[] ok = new int[1];
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) throw new IllegalStateException("shader: " + GLES20.glGetShaderInfoLog(s));
        return s;
    }

    static float clamp(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }
}
