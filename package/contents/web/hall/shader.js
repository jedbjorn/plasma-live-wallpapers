// Fragment shader for the three rooms. Raymarched SDF geometry, analytic sun
// visibility through the slot (so shadows and shafts are exact and cheap),
// procedural board-formed concrete, volumetric in-scattering, film grain.

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPtr;     // eased pointer, -1..1
uniform int   uRoom;    // 0 slot hall, 1 daylight gallery, 2 electric horizon
uniform float uTravel;  // room 0: 0..1 dolly through the slot
uniform float uWhite;   // 0..1 flood to white
uniform float uDusk;    // room 1: 0..1 daylight to night
uniform float uBlack;   // 0..1 visibility
uniform vec2  uShift;   // lens shift (keeps verticals vertical)
uniform float uFocal;
uniform float uScroll;  // 0..1 slow progress inside a room
uniform vec2  uSun;     // room 0: azimuth, elevation (as x/z, y/z)
uniform int   uQuality; // 0 low, 1 normal
uniform float uNudge;   // room 0: 0..1 pulse that brightens the opening
uniform float uTod;     // room 0: time of day, 0..1 around a loop. 0 = day (the default, and the home page's look),
                        // about .33 evening, .52 to .72 night, about .85 dawn, 1 = day again
uniform float uSoft;    // room 0: 0..1 dims and softens the glow of the opening: at 1, by a tenth, and by about a quarter in daylight. 0 = unchanged

// ---------------------------------------------------------------- utilities
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x), mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x), mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(17.1,3.7,9.2); a*=.5; } return s; }
float fbm2(vec3 p){ return .5*vnoise(p)+.25*vnoise(p*2.03+vec3(17.1,3.7,9.2)); }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float boxHit(vec3 ro, vec3 rd, vec3 c, vec3 b){
  vec3 m=1./rd; vec3 n=m*(ro-c); vec3 k=abs(m)*b; vec3 t1=-n-k, t2=-n+k;
  float tN=max(max(t1.x,t1.y),t1.z), tF=min(min(t2.x,t2.y),t2.z);
  return (tN<tF && tF>0.) ? 1. : 0.;
}
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
float hg(float c, float g){ float g2=g*g; return (1.-g2)/pow(1.+g2-2.*g*c,1.5)*.0796; }

// board-formed concrete: mottling, formwork seams, tie holes, weather streaks
float gDist=0.;
float concrete(vec3 p, vec3 n){
  float dt_=smoothstep(34.,9.,gDist);
  vec2 uv; bool flr=false;
  if(abs(n.y)>.5){ uv=p.xz; flr=n.y>0.; } else if(abs(n.z)>.5) uv=p.xy; else uv=p.zy;
  float m=fbm(p*.55+3.1), f=fbm2(p*6.), ff=vnoise(p*38.);
  float a=(.74+.52*m)*(.9+.2*f*dt_)*(1.+.08*(ff-.5)*smoothstep(16.,4.,gDist));
  if(abs(n.y)<.5){
    vec2 g=uv/vec2(1.8,.9); vec2 id=floor(g); vec2 fr=fract(g);
    a*=.93+.14*hash12(id+7.);
    vec2 e=min(fr,1.-fr)*vec2(1.8,.9);
    a*=mix(mix(.92,.7,dt_),1.,smoothstep(0.,.016+.0012*gDist,min(e.x,e.y)));
    vec2 h=(fract(g*vec2(3.,2.))-.5)*vec2(.6,.45);
    a*=mix(mix(1.,.42,dt_),1.,smoothstep(.02,.036+.001*gDist,length(h)));
    a*=.92+.16*vnoise(vec3(uv.x*3.,uv.y*.22,2.));
  } else if(flr){
    vec2 fr=fract(uv/3.); vec2 e=min(fr,1.-fr)*3.;
    a*=mix(.72,1.,smoothstep(0.,.014,min(e.x,e.y)));
  }
  return a;
}

// ================================================================== ROOM 0
// A concrete hall. The end wall is cut by one leaning slot (the slash); two
// bracket-shaped monoliths stand in front of it. Sun enters only by the slot.
const float HW=7.0, CEIL=7.0, WT=0.36, SLOT_TOP=5.7;
const vec2 SD=vec2(.242536,.970143);
float slotW;

float slotSd(vec2 q){
  vec2 r=q-vec2(0.,2.85);
  return max(abs(r.x*SD.y-r.y*SD.x)-slotW, q.y-SLOT_TOP);
}
float map0(vec3 p){
  float d=min(min(p.y, CEIL-p.y), HW-abs(p.x));
  float wall=sdBox(p-vec3(0.,CEIL*.5,WT*.5), vec3(HW+1.,CEIL*.5+1.,WT*.5));
  d=min(d, max(wall,-slotSd(p.xy)));
  vec3 q=vec3(abs(p.x),p.y,p.z);
  float b=sdBox(q-vec3(3.42,3.05,-1.7), vec3(.36,3.05,.75));
  b=min(b, sdBox(q-vec3(2.80,5.74,-1.7), vec3(.98,.36,.75)));
  b=min(b, sdBox(q-vec3(2.80,.36,-1.7), vec3(.98,.36,.75)));
  return min(d,b);
}
float sunVis0(vec3 p, vec3 L, bool boxes){
  if(p.z>WT) return 1.;
  float tb=(WT-p.z)/L.z; vec3 qb=p+L*tb;
  float pen=.012+.016*tb;
  float v=smoothstep(pen,-pen,slotSd(qb.xy));
  if(p.z<0.){ vec3 qf=p+L*(-p.z/L.z); v*=smoothstep(pen,-pen,slotSd(qf.xy)); }
  if(boxes && v>.001 && p.z<-.9){
    float h=0.;
    for(int s=0;s<2;s++){
      float sx=s==0?1.:-1.;
      h=max(h,boxHit(p,L,vec3(sx*3.42,3.05,-1.7),vec3(.36,3.05,.75)));
      h=max(h,boxHit(p,L,vec3(sx*2.80,5.74,-1.7),vec3(.98,.36,.75)));
      h=max(h,boxHit(p,L,vec3(sx*2.80,.36,-1.7),vec3(.98,.36,.75)));
    }
    v*=1.-h;
  }
  return v;
}
vec3 nrm0(vec3 p){ vec2 e=vec2(.002,0.);
  return normalize(vec3(map0(p+e.xyy)-map0(p-e.xyy), map0(p+e.yxy)-map0(p-e.yxy), map0(p+e.yyx)-map0(p-e.yyx))); }
float ao0(vec3 p, vec3 n){ float o=0., s=1.; for(int i=1;i<=4;i++){ float h=.09*float(i)*float(i); o+=(h-map0(p+n*h))*s; s*=.6; } return clamp(1.-.9*o,0.,1.); }

vec3 room0(vec2 uv){
  float tr=uTravel;
  slotW=mix(.17,2.2,pow(smoothstep(.12,1.,tr),2.2));
  vec3 ro=vec3(mix(0.,-.29,smoothstep(0.,.8,tr))+uPtr.x*.22*(1.-tr), 1.7+uPtr.y*.04*(1.-tr), -12.+tr*12.3);
  vec3 rd=normalize(vec3(uv,uFocal));
  vec3 L=normalize(vec3(uSun.x+1e-4, uSun.y, 1.));
  vec3 sunC=vec3(.62,.80,1.)*11.;
  vec3 skyC=vec3(.66,.82,1.)*9.*(1.+.5*uNudge);
  sunC*=1.+.35*uNudge;
  // time of day: eve = golden hour, dawn = a softer sunrise glow, night = moonlight. All are 0 at uTod 0.
  // Sunset and sunrise each have their own palette: blending the day's blue toward one amber only gave a grey dawn.
  // walking toward the opening always brings the day back, so the flood to white beyond it still reads as daylight
  float dayK=1.-smoothstep(.15,.6,tr);
  float night=(smoothstep(.36,.52,uTod)-smoothstep(.70,.84,uTod))*dayK;
  float eve=smoothstep(.10,.33,uTod)*(1.-smoothstep(.36,.52,uTod))*dayK;
  float dawn=smoothstep(.71,.82,uTod)*(1.-smoothstep(.87,.985,uTod))*dayK;
  float dayAmt=1.-clamp(eve+dawn+night,0.,1.);
  float glowK=1.-(.1+.14*dayAmt)*uSoft;          // daylight is the brightest hour, so it gives up the most
  float warm=eve+.75*dawn;
  vec3 skyEve=mix(vec3(1.,.43,.14)*1.7, vec3(.86,.27,.36)*1.15, smoothstep(-.04,.34,rd.y));    // amber at the foot of the slot, rose above
  vec3 skyDawn=mix(vec3(1.,.56,.34)*1.25, vec3(.82,.46,.58)*.85, smoothstep(-.04,.34,rd.y));  // peach at the foot, soft pink above: paler than sunset
  sunC=mix(sunC, vec3(1.,.52,.2)*7.5, eve);
  sunC=mix(sunC, vec3(1.,.58,.42)*5., dawn);
  sunC=mix(sunC, vec3(.30,.40,.66)*.95, night);
  skyC=mix(skyC, skyEve, eve);
  skyC=mix(skyC, skyDawn, dawn);
  skyC=mix(skyC, vec3(.010,.017,.045), night);
  sunC*=1.-.12*dayAmt*uSoft;

  float t=0.; bool sky=false;
  for(int i=0;i<96;i++){
    vec3 p=ro+rd*t;
    if(p.z>WT+.03){ sky=true; break; }
    float d=map0(p);
    if(d<.0012*t+.0004) break;
    t+=d; if(t>70.) break;
  }
  vec3 col;
  if(sky){
    col=skyC*(1.+.25*uv.y);
    if(night>.001){   // a few fine, still stars, seen only through the opening
      vec2 sp=rd.xy/rd.z*84.; vec2 id=floor(sp); vec2 f=fract(sp)-.5;
      float h=hash12(id+17.3);
      vec2 o=(vec2(hash12(id+3.1),hash12(id+8.7))-.5)*.6;
      float px=84.*2./(uFocal*uRes.y);                       // one pixel, in cell units
      float star=smoothstep(1.5*px+.02,.35*px,length(f-o))*step(.868,h);
      float tw=.8+.2*sin(uTime*1.1+h*50.);
      col+=vec3(.78,.86,1.)*star*tw*(.9+2.6*fract(h*37.))*night*night;
    }
  } else {
    vec3 p=ro+rd*t; vec3 n=nrm0(p);
    gDist=t; float alb=.30*concrete(p,n);
    float ao=ao0(p,n);
    float vis=sunVis0(p+n*.012,L,true);
    vec3 lit=sunC*vis*max(dot(n,L),0.);
    // light bounced off the blade on the floor
    for(int i=0;i<3;i++){
      float y=.8+1.9*float(i);
      vec3 bp=vec3((y-2.85)*.25-y*L.x/L.y, .03, -y*L.z/L.y);
      vec3 dd=bp-p; float r2=dot(dd,dd); vec3 l=dd*inversesqrt(r2);
      lit+=sunC*.21*max(dot(n,l),0.)*(.25+.75*max(-l.y,0.))/(r2*.5+1.2);
    }
    // sky glow from the slot itself
    for(int i=0;i<3;i++){
      float y=.8+2.*float(i);
      vec3 sp=vec3((y-2.85)*.25, y, WT*.5);
      vec3 dd=sp-p; float r2=dot(dd,dd); vec3 l=dd*inversesqrt(r2);
      lit+=skyC*.24*max(dot(n,l),0.)*(.15+.85*max(l.z,0.))/(r2+.4);
    }
    lit+=vec3(.010,.013,.020)*(.5+.5*n.y)+vec3(.016,.021,.032)*max(-n.z,0.);
    lit+=night*vec3(.005,.008,.016);
    col=vec3(1.,.985,.955)*alb*lit*ao;
    // polished floor: the slot mirrored as a long streak
    if(n.y>.9){
      vec3 R=reflect(rd,n);
      if(R.z>0.){
        float tt=-p.z/R.z; vec3 q=p+R*tt;
        float blur=.05+.05*tt;
        float m=smoothstep(blur,-.3*blur,slotSd(q.xy));
        float fr=.03+.97*pow(1.-max(dot(-rd,n),0.),5.);
        col+=skyC*m*fr*.42*glowK*(.55+.6*fbm2(vec3(p.xz*2.2,1.)));
      }
    }
  }
  // volumetric shaft
  int NS=uQuality>0?26:14;
  float tm=min(t,30.), dt=tm/float(NS), j=ign(gl_FragCoord.xy+fract(uTime)*61.);
  float acc=0.;
  for(int i=0;i<NS;i++){
    vec3 p=ro+rd*((float(i)+j)*dt);
    float v=sunVis0(p,L,true);
    if(v>.001) acc+=v*(.45+1.1*fbm2(p*1.25+vec3(0.,-uTime*.035,uTime*.02)));
  }
  col+=sunC*acc*dt*hg(dot(rd,L),.5)*.12*glowK;
  // halation around the opening
  float tp=-ro.z/rd.z; vec2 q=(ro+rd*tp).xy;
  float sdr=max(slotSd(q), slotSd((ro+rd*(tp+WT/rd.z)).xy));
  float sd=max(sdr,0.);
  float front=sky?1.:smoothstep(tp-3.,tp-.2,t)*.75+.25;
  // analytic edge coverage for the opening, so the blade stays clean at reduced resolution
  float fw=1.3*tp/(uFocal*uRes.y*.5);
  float cov=clamp(.5-sdr/(2.*fw),0.,1.);

  col+=mix(mix(vec3(.36,.55,.95), vec3(1.,.42,.2)*.8, warm), vec3(.05,.08,.2)*.25, night)*(exp(-sd*1.5)*.035+exp(-sd*mix(7.,6.3,uSoft))*.30)*glowK*front*(1.+1.6*uNudge);
  col=aces(col*1.05);
  // coverage is blended after tone mapping: the sky is so much brighter than the wall
  // that a linear blend would only move the hard edge, not soften it
  float tk=max(warm,night); vec3 skyT=aces(skyC*1.05);     // edge tones follow the sky once it is no longer day
  if(sky) col=mix(mix(vec3(.52,.66,.90), skyT*.75, tk), col, mix(cov,1.,smoothstep(0.,.6,uTravel)));
  else if(t>tp-.05) col=mix(col, mix(vec3(.93,.97,1.), skyT, tk), cov);
  return col;
}

// ================================================================== ROOM 1
// A pale gallery in cool daylight. Sun rakes in between deep fins on the right.
float map1(vec3 p){
  float d=min(min(p.y, 9.-p.y), min(18.-p.z, p.x+10.));
  d=min(d, sdBox(p-vec3(1.4,.42,9.5), vec3(3.6,.42,.85)));
  d=min(d, sdBox(p-vec3(-5.4,3.3,13.), vec3(.6,3.3,1.9)));
  vec3 q=p; q.z=mod(q.z,2.4)-1.2;
  d=min(d, sdBox(q-vec3(10.2,4.5,0.), vec3(1.0,4.6,.5)));
  return d;
}
float sunVis1(vec3 p, vec3 L){
  float v=1.;
  for(int i=0;i<2;i++){
    float xp=i==0?9.2:11.2;
    if(p.x<xp){ float tt=(xp-p.x)/L.x; vec3 q=p+L*tt; float g=abs(mod(q.z,2.4)-1.2)-.5; float pen=.02+.012*tt;
      v*=smoothstep(-pen,pen,g)*step(q.y,9.1+step(.5,float(i))*9.); }
  }
  if(v>.001){
    v*=1.-boxHit(p,L,vec3(1.4,.42,9.5),vec3(3.6,.42,.85));
    v*=1.-boxHit(p,L,vec3(-5.4,3.3,13.),vec3(.6,3.3,1.9));
  }
  return v;
}
vec3 nrm1(vec3 p){ vec2 e=vec2(.002,0.);
  return normalize(vec3(map1(p+e.xyy)-map1(p-e.xyy), map1(p+e.yxy)-map1(p-e.yxy), map1(p+e.yyx)-map1(p-e.yyx))); }
float ao1(vec3 p, vec3 n){ float o=0., s=1.; for(int i=1;i<=4;i++){ float h=.1*float(i)*float(i); o+=(h-map1(p+n*h))*s; s*=.6; } return clamp(1.-.7*o,0.,1.); }

vec3 room1(vec2 uv){
  float dk=uDusk;
  vec3 ro=vec3(-1.2+uPtr.x*.3, 1.6+uPtr.y*.05, -5.+uScroll*5.5);
  vec3 rd=normalize(vec3(uv,uFocal));
  float el=mix(.66,.13,smoothstep(0.,.9,dk));
  vec3 L=normalize(vec3(1., el, -.78+uPtr.x*.10+.07*sin(uTime*.06)+uScroll*.3));
  float night=smoothstep(.35,1.,dk);
  vec3 sunC=mix(vec3(1.,.965,.91)*3.3, vec3(1.,.42,.16)*2.6, smoothstep(.05,.6,dk))*(1.-night);
  vec3 skyC=mix(vec3(.63,.73,.88), vec3(.10,.10,.22), smoothstep(0.,.7,dk))*(1.-.985*night);

  float t=0.; bool sky=false;
  for(int i=0;i<90;i++){
    vec3 p=ro+rd*t;
    if(p.x>11.4){ sky=true; break; }
    float d=map1(p);
    if(d<.0012*t+.0004) break;
    t+=d*.9; if(t>80.) break;
  }
  vec3 col;
  if(sky){ col=skyC*2.4+sunC*.25; }
  else {
    vec3 p=ro+rd*t; vec3 n=nrm1(p);
    gDist=t; float alb=.62*mix(1.,concrete(p,n),.5);
    float ao=ao1(p,n);
    float vis=sunVis1(p+n*.012,L);
    vec3 lit=sunC*vis*max(dot(n,L),0.);
    lit+=skyC*(.34+.2*n.y)*ao;
    lit+=sunC*.06*ao*(.5+.5*max(-n.x,0.));
    col=vec3(1.,.995,.985)*alb*lit;
    if(n.y>.9){
      float fr=.03+.97*pow(1.-max(dot(-rd,n),0.),5.);
      col+=skyC*fr*.55;
    }
  }
  float fogA=1.-exp(-t*.011);
  col=mix(col, skyC*.8+sunC*.03, sky?0.:fogA);
  int NS=uQuality>0?20:10;
  float tm=min(t,34.), dt=tm/float(NS), j=ign(gl_FragCoord.xy+fract(uTime)*61.);
  float acc=0.;
  j=.5;
  for(int i=0;i<NS;i++){ acc+=sunVis1(ro+rd*((float(i)+j)*dt),L); }
  col+=sunC*acc*dt*.0042*(1.+.5*hg(dot(rd,L),.4)*12.);
  col=col/(1.+col*.36);
  col*=1.1;
  return col;
}

// ================================================================== ROOM 2
// After hours. One horizontal slit of electric light at the top of the view,
// a field of standing columns in silhouette, a floor like still water.
const float SLY=1.5;
const vec3 ROWZ=vec3(-4.6,-8.4,-11.2);
float finH(float id, float row){ return hash12(vec2(id,9.1+row*5.3))<(row<.5?.25:.62) ? -1. : 2.4+5.*hash12(vec2(id,3.7+row)); }
float rowOff(float row){ return row*.83; }
float colRow(vec3 p, float row, float z){
  float px=p.x+rowOff(row);
  float id=floor((px+1.)/2.); float qx=px-id*2.; float h=finH(id,row);
  float f=sdBox(vec3(qx,p.y-h*.5,p.z-z), vec3(.15,h*.5,.15));
  return min(f, 1.-abs(qx)+.2);
}
float map2(vec3 p){
  float d=min(min(p.y, 9.-p.y), min(-p.z, 14.-abs(p.x)));
  d=min(d,colRow(p,0.,ROWZ.x)); d=min(d,colRow(p,1.,ROWZ.y)); d=min(d,colRow(p,2.,ROWZ.z));
  return d;
}
vec3 slitCol(float x){
  float k=smoothstep(-10.,10.,x)+(uScroll-.5)*.7;
  vec3 c=mix(vec3(.30,.26,1.), vec3(.62,.2,1.), smoothstep(-.3,.2,k));
  c=mix(c, vec3(1.,.16,.52), smoothstep(.15,.6,k));
  c=mix(c, vec3(1.,.40,.06), smoothstep(.55,1.05,k));
  float pulse=.72+.2*sin(x*.6-uTime*.5);
  pulse+=.9*exp(-pow(mod(x+uTime*1.6+15.,30.)-15.,2.)*.5);
  return c*pulse;
}
float finBlock(vec3 p, vec3 d){ // d not normalised; does p + d*s pass through a column?
  if(d.z<=0.) return 0.;
  float b=0.;
  for(int r=0;r<3;r++){
    float z=ROWZ[r]; float row=float(r);
    if(p.z>z-.16) continue;
    float s=(z-p.z)/d.z; vec3 h=p+d*s;
    float hx=h.x+rowOff(row);
    float id=floor((hx+1.)/2.);
    float w=.02+.012*length(d*s);
    b=max(b, smoothstep(.15+w,.15-w,abs(hx-id*2.))*step(h.y,finH(id,row)));
  }
  return b;
}
vec3 nrm2(vec3 p){ vec2 e=vec2(.002,0.);
  return normalize(vec3(map2(p+e.xyy)-map2(p-e.xyy), map2(p+e.yxy)-map2(p-e.yxy), map2(p+e.yyx)-map2(p-e.yyx))); }

vec3 room2(vec2 uv){
  vec3 ro=vec3(uPtr.x*.4+(uScroll-.5)*3., 1.22+uPtr.y*.04, -14.);
  vec3 rd=normalize(vec3(uv,uFocal));
  float t=0.;
  for(int i=0;i<80;i++){
    vec3 p=ro+rd*t; float d=map2(p);
    if(d<.0012*t+.0004) break;
    t+=d*.85; if(t>70.) break;
  }
  vec3 p=ro+rd*t; vec3 n=nrm2(p);
  vec3 col;
  float inSlit=smoothstep(.055,.04,abs(p.y-SLY))*step(-.09,p.z)*smoothstep(11.6,11.2,abs(p.x));
  gDist=t; float alb=.26*concrete(p,n);
  float j=ign(gl_FragCoord.xy+fract(uTime)*37.);
  vec3 lit=vec3(0.);
  int NL=uQuality>0?6:4; float stepx=20./float(NL);
  for(int i=0;i<NL;i++){
    float lx=-10.+(float(i)+j)*stepx;
    vec3 dd=vec3(lx,SLY,0.)-p; float r2=dot(dd,dd); vec3 l=dd*inversesqrt(r2);
    float sh=1.-finBlock(p+n*.01,dd);
    lit+=slitCol(lx)*max(dot(n,l),0.)*max(l.z,0.)*sh/(r2+.6);
  }
  col=alb*lit*(17./float(NL));
  if(p.z>-.09){ float dy=abs(p.y-SLY); col+=alb*slitCol(p.x)*(exp(-dy*1.6)*.35+exp(-dy*9.)*1.2)*smoothstep(11.8,10.5,abs(p.x)); }
  col=mix(col, slitCol(p.x)*7., inSlit);
  // wet floor
  if(n.y>.9){
    vec2 w=vec2(fbm2(vec3(p.xz*.9,uTime*.12))-.375, fbm2(vec3(p.zx*.9+7.,uTime*.1))-.375);
    vec3 nn=normalize(vec3(w.x*.012,1.,w.y*.028));
    vec3 R=reflect(rd,nn);
    if(R.z>0.){
      float tw=-p.z/R.z; vec3 q=p+R*tw;
      float blk=finBlock(p+vec3(0.,.01,0.),R);
      float dy=(q.y-SLY);
      float m=exp(-dy*dy/(.003+.0004*tw*tw))+.035*exp(-abs(dy)*1.1);
      float fr=.05+.95*pow(1.-max(dot(-rd,nn),0.),5.);
      col+=slitCol(q.x)*m*.8*fr*(1.-blk)*smoothstep(11.8,10.8,abs(q.x));
    }
  }
  // haze
  float tp=-ro.z/rd.z; vec3 q=ro+rd*tp; float dy=abs(q.y-SLY);
  float front=smoothstep(tp-12.,tp-.5,t);
  col+=slitCol(q.x)*(exp(-dy*.8)*.05+exp(-dy*4.5)*.22)*front*smoothstep(12.5,9.,abs(q.x));
  col=aces(col*1.1);
  return col;
}

void main(){
  vec2 uv=(gl_FragCoord.xy-.5*uRes)/(.5*uRes.y)+uShift;
  vec2 sv=gl_FragCoord.xy/uRes-.5;
  vec3 col;
  if(uRoom==0) col=room0(uv); else if(uRoom==1) col=room1(uv); else col=room2(uv);
  col=pow(max(col,0.),vec3(1./2.2));
  float vg=dot(sv,sv);
  col*=uRoom==1 ? 1.-.22*vg : 1.-.9*vg;
  if(uRoom!=1){ col=mix(col, col*vec3(.94,.98,1.06), .5); }
  col=mix(col, vec3(.945,.955,.965), uWhite);
  col*=uBlack;
  float lum=dot(col,vec3(.3,.6,.1));
  float g=hash12(gl_FragCoord.xy+fract(floor(uTime*24.)*.1371)*917.)-.5;
  col+=g*mix(.055,.026,smoothstep(0.,.7,lum));
  fragColor=vec4(col,1.);
}`;
