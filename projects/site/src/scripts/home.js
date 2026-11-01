import { dashboardUrl } from "../dashboard-url.js"
import {
    BOX,
    FE,
    featureDescription,
    featureDocs,
    featurePath,
    featureTitle,
    homeDescription,
    homeTitle,
} from "../features.js"

;(() => {
    const $ = (i) => document.getElementById(i),
        art = (k) => document.querySelector(`[data-a="${k}"]`).src,
        R = "https://github.com/NeonTechSpace/NeonFlux",
        root = document.documentElement,
        nf = $("nf")
    try {
        history.scrollRestoration = "manual"
    } catch {}
    let homeY = 0
    const framed = window.__inline || window.self !== window.top
    if (!framed) root.classList.add("page")
    const ss = (a, b, x) => {
            x = Math.min(1, Math.max(0, (x - a) / (b - a)))
            return x * x * (3 - 2 * x)
        },
        store = {
            get() {
                try {
                    return localStorage.getItem("nf.motion")
                } catch {
                    return null
                }
            },
            set(v) {
                try {
                    localStorage.setItem("nf.motion", v)
                } catch {}
            },
        }
    let motion = store.get() ? store.get() === "on" : !matchMedia("(prefers-reduced-motion: reduce)").matches
    const desktop = () =>
        matchMedia(
            framed ? "(hover:hover) and (pointer:fine)" : "(hover:hover) and (pointer:fine) and (min-width:1024px)",
        ).matches
    const byK = Object.fromEntries(FE.map((f) => [f.k, f]))
    // The feature a page's address names, or null on the homepage
    const pageFeature = () => {
        const slug = /^\/features\/([^/]+)\/?$/.exec(location.pathname)?.[1]
        return FE.find((f) => f.d === slug)?.k ?? null
    }
    // Older links used #f-moderation style addresses
    const adoptOldLink = () => {
        const old = /^#f-(.+)$/.exec(location.hash)?.[1]
        if (byK[old]) history.replaceState(null, "", featurePath(byK[old]))
        else if (location.hash === "#home") history.replaceState(null, "", "/")
    }
    adoptOldLink()
    /* ---------- shared GLSL ---------- */
    const NOISE = `float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float field(vec2 p,float t,vec2 m,vec3 rp){vec2 q=p*1.7;q+=.38*vec2(sin(q.y*1.3+t*.13),cos(q.x*1.1-t*.11));q+=.18*vec2(sin(q.y*2.7-t*.09),sin(q.x*2.3+t*.07));vec2 d=p-m;q+=d*1.1*exp(-dot(d,d)*7.);vec2 e=p-rp.xy;float r=length(e);q+=e/max(r,.001)*sin(r*26.-rp.z*14.)*exp(-rp.z*2.2)*exp(-r*2.)*.16;return sin(q.x*1.2+t*.05)+cos(q.y*1.4-t*.04)+.5*sin(q.x*2.1+q.y*1.7);}
vec3 sky(vec2 p,float t,vec2 m,vec3 rp,vec2 fc,float base,float glow){vec2 pn=p+vec2(0.,S*.42);float f=field(pn,t,m,rp),v=f*5.5,w=fwidth(v);float l=1.-smoothstep(0.,w*1.3,abs(fract(v)-.5));vec2 d=p-m;float g=exp(-dot(d,d)*5.);vec3 lc=mix(vec3(.43,.63,1.),vec3(.69,.5,1.),.5+.5*sin(p.x*1.6+p.y));vec3 c=vec3(.039,.043,.086);vec2 a1=p-vec2(.24,.42),a2=p-vec2(.74,.06);float lo=smoothstep(-.5,-.08,p.y);c+=L*lo*(vec3(.337,.408,1.)*.3*exp(-dot(a1,a1)*5.5)+vec3(.59,.27,1.)*.15*exp(-dot(a2,a2)*9.));
#ifdef FAR
{float f2=field(p*.52+vec2(3.,S*.13),t*.6,vec2(9.),vec3(0.,0.,9.)),v2=f2*3.2,w2=fwidth(v2);float l2=1.-smoothstep(0.,w2*1.1,abs(fract(v2)-.5));c+=lc*l2*base*.32;}
#endif
c+=lc*l*(base*.62+glow*g);return c+(hash(vec3(fc,1.))-.5)/170.;}`
    const VS = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`
    const HERO = `#version 300 es
precision highp float;uniform vec2 RS,M;uniform vec3 V,BC,LC,RP;uniform float T,seal,scan,PA,bgT,smoke,chk,S,L,FL,OP,BS;uniform mat3 Q,QL;uniform float SHD;uniform vec4 TX;uniform vec4 P[12];uniform float PI[12];uniform sampler2D W,A,E,C;out vec4 o;const float D=5.,B=2.4;${NOISE}
bool box(vec3 ro,vec3 rd,mat3 q,vec3 c,vec3 h,out float a,out float b,out vec3 na,out vec3 nb){vec3 O=(ro-c)*q,d=rd*q;d+=vec3(equal(d,vec3(0)))*1e-5;vec3 m=1./d,n=m*O,k=abs(m)*h,t1=-n-k,t2=-n+k;a=max(max(t1.x,t1.y),t1.z);b=min(min(t2.x,t2.y),t2.z);if(a>b||b<0.)return false;na=q*(-sign(d)*step(t1.yzx,t1.xyz)*step(t1.zxy,t1.xyz));nb=q*(sign(d)*step(t2.xyz,t2.yzx)*step(t2.xyz,t2.zxy));return true;}
float edge(vec3 p,vec3 c,mat3 q,vec3 h){vec3 d=h-abs((p-c)*q);float a=min(d.x,min(d.y,d.z)),b=max(d.x,max(d.y,d.z));return d.x+d.y+d.z-a-b;}
vec3 env(vec3 d){return mix(vec3(.03,.04,.15),vec3(.2,.11,.42),.5+.5*d.y)+vec3(.2,.26,.55)*pow(max(d.y,0.),6.);}
vec3 drawP(vec3 col,vec3 ro,vec3 rd,bool hit,float a,float opq,bool front){for(int i=0;i<12;i++){if(P[i].w<=0.)continue;float t=(P[i].z-ro.z)/rd.z;bool fr=hit&&t<a;if(fr!=front)continue;vec3 w=ro+rd*t;vec2 u=(w.xy-P[i].xy)/P[i].w*.5+.5;if(u.x<0.||u.y<0.||u.x>1.||u.y>1.)continue;float id=PI[i];vec2 cell=vec2(mod(id,4.),2.-floor(id/4.));vec4 s=textureLod(A,(u*.94+.03+cell)/vec2(4,3),max(0.,log2(256./(2.*P[i].w*V.z))))*PA;s.rgb*=mix(.72,1.,smoothstep(-.5,.15,P[i].z))*(P[i].z>1.?mix(.8,1.,smoothstep(1.5,1.88,P[i].z)):1.);if(hit&&t>a)s*=1.-opq;col=col*(1.-s.a)+s.rgb;}return col;}
void main(){vec2 fc=gl_FragCoord.xy,p0=(fc-.5*RS)/min(RS.x,RS.y),sp=(fc-V.xy)/V.z;vec3 ro=vec3(0,0,D),rd=normalize(vec3(sp,-D));vec2 sq=max(TX.xy-fc,fc-TX.zw);float tq=smoothstep(0.,.3*RS.y,length(max(sq,vec2(0.))));vec3 sk=sky(p0,bgT,M,RP,fc,.09*tq,.2*tq);vec4 wd=texture(W,fc/RS);vec3 col=sk*(1.-wd.a)+wd.rgb;{vec2 so=sp-vec2(0.,-1.42);col*=1.-.55*SHD*exp(-so.x*so.x*.9-so.y*so.y*14.);col+=vec3(.26,.28,.75)*FL*exp(-dot(sp,sp)*.16);}
vec3 BH=vec3(1,.725,1)*BS,LH=vec3(1,.275,1)*BS;float a=0.,b=0.,a2=0.,b2=0.;vec3 na=vec3(0),nb=vec3(0),na2=vec3(0),nb2=vec3(0);bool h=false,h2=false;if(OP<.995){h=box(ro,rd,Q,BC,BH,a,b,na,nb);h2=box(ro,rd,QL,LC,LH,a2,b2,na2,nb2);}float s1=b-a,s2=b2-a2,chord=max(s1/max(fwidth(s1),1e-5),s2/max(fwidth(s2),1e-5));vec3 c0=col;bool hit=h||h2;mat3 q=Q;vec3 c=BC,hs=BH;float cy=-.275;if(h2&&(!h||a2<a)){a=a2;b=b2;na=na2;nb=nb2;q=QL;c=LC;hs=LH;cy=.725;}
float opq=0.,burn=0.,lw=2.2/V.z;vec3 P0=vec3(0),cube=vec3(0);if(hit){lw=2.2/V.z/max(-dot(rd,na),.14);P0=ro+rd*a;vec3 l=(P0-c)*q;cube=vec3(l.x,l.y+cy,l.z);float nv=vn(cube*2.4+1.)*.6+vn(cube*6.)*.4,th=seal*1.3-.15;opq=1.-smoothstep(th-.015,th+.015,nv);if(seal>.001&&seal<.999)burn=exp(-abs(nv-th)*50.);
vec3 ra=refract(rd,na,1./1.42);float ta,tb;vec3 n2,n3;box(P0,ra,q,c,hs,ta,tb,n2,n3);vec3 X=P0+ra*tb,re;vec3 rm=refract(ra,-n3,1.442);if(dot(rm,rm)<.01)re=env(reflect(ra,-n3))*.55;else if(rm.z>-.02)re=env(rm)*.55;else for(int k=0;k<3;k++){vec3 r=refract(ra,-n3,1.42+float(k)*.022);if(dot(r,r)<.01)r=rm;vec3 sh=X+r*((-B-X.z)/min(r.z,-.02));vec2 px=V.xy+V.z*sh.xy*D/(D+B);vec4 w=texture(W,px/RS);re[k]=(sk*(1.-w.a)+w.rgb)[k]+env(r)[k]*.12;}
col=re*mix(vec3(1),vec3(.74,.78,1.),clamp(tb*.24,0.,1.));if(smoke>.001){vec3 fr=mix(vec3(.07,.05,.24),vec3(.15,.11,.46),.5+.5*P0.y)+vec3(.09,.07,.26)*vn(cube*2.2+vec3(0,T*.12,0));col=mix(col,fr,smoke*.94);}float e2=edge(X,c,q,hs);col+=mix(vec3(.43,.63,1.),vec3(.69,.5,1.),.5+.5*(X.y))*((1.-smoothstep(0.,lw,e2))*.55+.12*exp(-e2*22.))*(1.-.3*OP);
vec3 O2=(ro-c)*q,d2=rd*q;float ts=(scan-cy-O2.y)/d2.y;if(ts>a&&ts<b)col+=vec3(.25,.36,.95)*.18;if(chk>.001){vec3 ns=n3*q,ab=abs(ns),lx=(X-c)*q,cx=vec3(lx.x,lx.y+cy,lx.z);vec2 fu=ab.z>.5?vec2(-cx.x*sign(ns.z),cx.y):ab.x>.5?vec2(cx.z*sign(ns.x),cx.y):vec2(cx.x,cx.z*sign(ns.y));vec2 cu=fu*.5+.5;cu.y+=T*.012;float cd=textureLod(C,cu,max(0.,log2(1024./(2.*V.z))-.5)).a;col=mix(col,col*.6,chk*.5);col+=vec3(.5,.74,1.)*cd*chk*.24;}}
if(PA>.001)col=drawP(col,ro,rd,hit,a,opq,false);
if(hit){float F=.05+.95*pow(1.+dot(rd,na),5.);vec3 Lv=normalize(vec3(-.5,.8,.6)),rf=reflect(rd,na);float e1=edge(P0,c,q,hs);vec3 ec=mix(vec3(.5,.68,1.),vec3(.76,.56,1.),.5+.5*P0.y)*(1.-.3*OP);if(chk>.001){vec3 ns=na*q,ab=abs(ns);vec2 fu=ab.z>.5?vec2(cube.x*sign(ns.z),cube.y):ab.x>.5?vec2(-cube.z*sign(ns.x),cube.y):vec2(cube.x,-cube.z*sign(ns.y));vec2 cu=fu*.5+.5;cu.y+=T*.012;float cd=textureLod(C,cu,max(0.,log2(1024./(2.*V.z))-.5)).a;col*=mix(vec3(1.),vec3(.9,.92,1.),chk);col+=vec3(.55,.76,1.)*cd*chk*.1;}col=mix(col,env(rf),F*.8);{float rim=pow(1.+dot(rd,na),3.);col+=rim*mix(vec3(.62,.38,1.),vec3(.55,.62,1.),smoothstep(-.4,.6,na.y))*.42*(1.-opq);}col+=vec3(.75,.82,1.)*pow(max(dot(rf,Lv),0.),90.)*1.1;col+=ec*((1.-smoothstep(0.,lw,e1))*1.15+.22*exp(-e1*26.));col+=vec3(.5,.62,1.)*exp(-abs(cube.y-scan)*42.)*1.1;
vec3 nl=na*q,lc=(P0-c)*q,m=vec3(.024,.027,.09)+.006*vn(lc*vec3(1.4,80.,1.4)+nl*3.);m+=vec3(.2,.26,.7)*pow(.5+.5*sin(cube.x*1.4+cube.y*.9-T*.5),24.)*.32;m+=vec3(.3,.36,.85)*pow(max(dot(rf,Lv),0.),16.)*.6;m+=vec3(.36,.3,.9)*pow(1.+dot(rd,na),3.)*.55;{vec3 ab=abs(nl);vec2 fu=ab.z>.5?vec2(cube.x*sign(nl.z),cube.y):ab.x>.5?vec2(-cube.z*sign(nl.x),cube.y):vec2(cube.x,-cube.z*sign(nl.y));vec2 uv=fu*.5+.5;float lod=max(0.,log2(1024./(2.*V.z))-.6);float e=smoothstep(.3,.7,textureLod(E,uv,lod).a),e3=textureLod(E,uv+vec2(.006,-.007),lod).a;m*=1.-.7*e3*(1.-e);m=mix(m,vec3(.82,.88,1.),e);}m+=ec*((1.-smoothstep(0.,lw,e1))*.8+.12*exp(-e1*30.));
col=mix(col,m,opq);col+=mix(vec3(.45,.6,1.),vec3(1.,.48,.75),clamp(cube.y*.5+.5,0.,1.))*burn*1.1;}
if(hit)col=mix(c0,col,clamp(chord,0.,1.)*(1.-smoothstep(.45,.98,OP)));if(OP>.001&&PA>.001)col=drawP(col,ro,rd,hit,a,opq,true);o=vec4(col,1);}`
    const BGF = `#version 300 es
precision highp float;uniform vec2 RS,M;uniform vec3 RP;uniform float T,S,L;out vec4 o;
#define FAR
${NOISE}
void main(){vec2 fc=gl_FragCoord.xy,p=(fc-.5*RS)/min(RS.x,RS.y);o=vec4(sky(p,T,M,RP,fc,.05,.22),1);}`
    function prog(gl, fs) {
        const mk = (t, s) => {
            const x = gl.createShader(t)
            gl.shaderSource(x, s)
            gl.compileShader(x)
            if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(x))
            return x
        }
        const p = gl.createProgram()
        gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
        gl.linkProgram(p)
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p))
        gl.useProgram(p)
        gl.bindVertexArray(gl.createVertexArray())
        const u = {}
        for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
            const a = gl.getActiveUniform(p, i).name.replace("[0]", "")
            u[a] = gl.getUniformLocation(p, a)
        }
        return u
    }
    function tex(gl, unit, src, mip) {
        const t = gl.createTexture()
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        if (mip) gl.generateMipmap(gl.TEXTURE_2D)
        return t
    }
    /* ---------- hero ---------- */
    const CL = [
        ["Most bots keep their code locked away", `So you can't check what they do or change how they work`],
        ["The only bot you should ever need", "Moderation, roles, tickets, levels and more"],
        ["A bot you can trust", `Anyone can check what it does, even if you never look`],
        ["A bot you can own", "Change any part and keep your data. Pick a part to see what it does"],
        [
            "You can look, but this one's private",
            `It runs for one community. Join its server, or ask for permission to manage it`,
        ],
    ]
    let NA = false,
        knock = 0,
        knocks = 0
    const KN = [
        "Nobody's letting you in by knocking",
        "Still private",
        "It really is just for its own server",
        "You've got persistence. Maybe run your own?",
    ]
    const stick = $("stick"),
        canvas = $("gl"),
        claim = $("claim"),
        sub = $("sub"),
        ticks = [...$("ticks").children],
        hits = $("hits")
    let act = -1
    claim.innerHTML = CL.map(
        (c, i) =>
            `<p class="${i === 4 ? "na4" : ""}">${c[0]
                .split(" ")
                .map((w, k) => `<span class="w"><i style="--k:${k}">${w}</i></span>`)
                .join("")}</p>`,
    ).join("")
    sub.innerHTML = CL.map((c, i) => `<p class="${i === 4 ? "na4" : ""}">${c[1]}</p>`).join("")
    ;[2, 3].forEach((i) => claim.children[i].children[2].insertAdjacentHTML("afterend", "<br>"))
    const HINT = ["Scroll to open the box", "Keep scrolling", "Keep scrolling", "Keep scrolling to see a normal week"]
    function setAct(n) {
        if (n === act) return
        act = n
        ;[claim, sub].forEach((b) => [...b.children].forEach((c, i) => c.classList.toggle("on", i === n)))
        ticks.forEach((b, i) => {
            b.classList.toggle("done", i <= n)
            b.classList.toggle("now", i === n)
        })
        if (n < 4) $("hint").textContent = HINT[n]
    }
    const STOP = [0.05, 0.33, 0.56, 1]
    let idx = 0,
        bgDirty = true,
        lastY = 0
    let p = 0.05,
        tp = 0.05,
        autoT = null,
        visible = true,
        pm = [0, 0],
        pmT = [0, 0],
        rp = [0, 0, 9],
        T = 0
    BOX.forEach((f, i) => {
        const b = document.createElement("button")
        b.className = "hit"
        b.innerHTML = `<span>${f.n}</span>`
        b.dataset.i = i
        b.addEventListener("click", () => go(featurePath(f)))
        hits.append(b)
    })
    const hb = [...hits.children]
    ticks.forEach((b, i) =>
        b.addEventListener("click", () => {
            autoT = null
            jump(i)
        }),
    )
    function jump(i) {
        if (root.classList.contains("page"))
            window.scrollTo({
                top: $("pin").offsetTop + i * stick.offsetHeight,
                behavior: motion ? "smooth" : "auto",
            })
        else {
            idx = i
            tp = STOP[i]
            if (!motion) p = tp
        }
    }
    let G = null
    const WALL = [
        "    notice.reason !== grant.reason",
        ")",
        "    return yield* Effect.fail(new ModerationHandli",
        "// The member's notice is a DM, so its commands na",
        'const multi = config?.scope?.mode === "multi",',
        '    option = multi ? ` --server ${serverId}` : ""',
        "const name = yield* serverLabel(client, serverId)",
        "const length =",
        '    notice.action === "timeout" && notice.timeoutU',
        "        ? ` until ${at(Date.parse(notice.timeoutUn",
        '        : notice.action === "ban" && notice.durati',
        "          ? ` for ${duration(notice.durationSecond",
        '          : ""',
        "const card: Card = {",
        "    title: `${noticeTitles[notice.action]} ${name}",
        "    description: reasonText(notice.reason),",
        "    // Members are offered the appeal commands onl",
        "    ...(notice.appeals",
        "        ? {",
        "              fields: [",
        "                  [",
        '                      "Appeal",',
        "                      `Reply here with ${code(`!ap",
        "                  ],",
        '                  ["Your cases", `Reply here with ',
        "              ],",
        "          }",
    ]
    function initGL() {
        const gl = canvas.getContext("webgl2", {
            antialias: false,
            alpha: false,
            powerPreference: "high-performance",
        })
        if (!gl) throw Error("no webgl2")
        const u = prog(gl, HERO)
        G = { gl, u, scale: 1, wc: document.createElement("canvas"), ec: document.createElement("canvas") }
        const ec = G.ec
        ec.width = 1024
        ec.height = 1024
        const x = ec.getContext("2d")
        x.font = "800 200px Bricolage, sans-serif"
        x.textAlign = "center"
        x.textBaseline = "middle"
        x.fillStyle = "#fff"
        x.fillText("trust me", 512, 512)
        tex(gl, 2, ec, true)
        const cc = document.createElement("canvas")
        cc.width = 1024
        cc.height = 1024
        const cx = cc.getContext("2d")
        cx.font = "600 30px ui-monospace, Consolas, monospace"
        cx.textBaseline = "top"
        cx.fillStyle = "#fff"
        WALL.forEach((l, n) => cx.fillText(l, 40, 16 + n * 37))
        tex(gl, 3, cc, true)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.uniform1i(u.C, 3)
        gl.uniform1i(u.W, 0)
        gl.uniform1i(u.A, 1)
        gl.uniform1i(u.E, 2)
        const at = $("atlas"),
            up = () => {
                tex(gl, 1, at, true)
            }
        at.addEventListener("load", up)
        at.src = at.dataset.src
        size()
    }
    function size() {
        if (!G) return
        const r = stick.getBoundingClientRect()
        if (!r.width) return
        const touch = !matchMedia("(hover:hover)").matches,
            dpr = Math.min(devicePixelRatio || 1, touch ? 1.25 : 1.25) * G.scale,
            w = Math.round(r.width * dpr),
            h = Math.round(r.height * dpr),
            { gl, u } = G
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
        gl.uniform2f(u.RS, w, h)
        const hw = $("hword"),
            hr = hw.getBoundingClientRect(),
            cs = getComputedStyle(hw),
            wc = G.wc
        wc.width = w
        wc.height = h
        const x = wc.getContext("2d")
        x.scale(dpr, dpr)
        x.font = `560 ${cs.fontSize} Bricolage, sans-serif`
        x.textBaseline = "alphabetic"
        try {
            x.letterSpacing = cs.letterSpacing
        } catch {}
        const a = NA ? "Priv" : "Neon",
            bw = NA ? "ate" : "Flux",
            tw = x.measureText(a + bw).width,
            fs = parseFloat(cs.fontSize),
            ta = cs.textAlign
        let lx = hr.left - r.left
        if (ta === "center") lx = (hr.width - tw) / 2 + (hr.left - r.left)
        const by = hr.top - r.top + hr.height * 0.5 + fs * 0.33
        x.fillStyle = "#f0f1ff"
        x.fillText(a, lx, by)
        const wa = x.measureText(a).width,
            g = x.createLinearGradient(lx + wa, 0, lx + tw, 0)
        g.addColorStop(0, "#6ea0ff")
        g.addColorStop(1, "#b07fff")
        x.fillStyle = g
        x.fillText(bw, lx + wa, by)
        tex(gl, 0, wc, false)
        const an = $("anchor").getBoundingClientRect(),
            say = document.querySelector(".h-say").getBoundingClientRect()
        let Lx = an.left,
            Rx = an.right,
            Ty = Math.max(an.top, r.top + 62),
            By = an.bottom
        if (say.right > Lx + 4 && say.bottom > Ty) Ty = say.bottom + 8
        if (hr.right > Lx + 4 && hr.left < Rx && hr.top < By) By = hr.top - 8
        const RW = Math.max(60, Rx - Lx),
            RH = Math.max(60, By - Ty)
        let mx = 0,
            my = 0
        for (let a = 0; a < 6.3; a += 0.2)
            for (const b0 of [0.18, 0.46, 0.74]) {
                const q = mul(ry(a), rx(b0))
                for (const X of [-1, 1])
                    for (const Y of [-1, 1])
                        for (const Z of [-1, 1]) {
                            const c = tv(q, [X, Y, Z]),
                                k = 5 / (5 - c[2])
                            mx = Math.max(mx, Math.abs(c[0]) * k)
                            my = Math.max(my, Math.abs(c[1]) * k)
                        }
            }
        G.s = Math.min(RW / 2 / mx, RH / 2 / my)
        G.cx = Lx - r.left + RW / 2
        G.cy = Ty - r.top + RH / 2
        G.dpr = dpr
        G.r = r
        gl.uniform3f(u.V, G.cx * dpr, h - G.cy * dpr, G.s * dpr)
        gl.uniform4f(
            u.TX,
            (say.left - r.left) * dpr,
            h - (say.bottom - r.top) * dpr,
            (say.right - r.left) * dpr,
            h - (say.top - r.top) * dpr,
        )
        const kb = $("knock").style,
            ks = G.s * 1.5
        kb.left = G.cx - ks + "px"
        kb.top = G.cy - ks + "px"
        kb.width = kb.height = ks * 2 + "px"
        const sp = { left: Lx, top: Ty, width: RW, height: RH },
            cols = [3, 4, 6].reduce((b, c) => {
                const f = (q) =>
                    sp.width / q < 84 ? 0 : Math.min((sp.width / q) * 0.62, (sp.height / Math.ceil(12 / q)) * 0.56)
                return f(c) > f(b) ? c : b
            }, 3),
            rows = Math.ceil(12 / cols),
            cw = sp.width / cols,
            chh = sp.height / rows
        G.cols = cols
        G.grid = BOX.map((f, i) => {
            const col = i % cols,
                px = sp.left - r.left + cw * (col + 0.5),
                py = sp.top - r.top + chh * (Math.floor(i / cols) + 0.4 + (col % 2 ? 0.14 : -0.06))
            return [(px - G.cx) / G.s, -(py - G.cy) / G.s, px, py]
        })
        G.cell = Math.min(cw * 0.62, chh * 0.56) / G.s / 2
        G.cw = cw
    }
    const mul = (a, b) => {
            const r = Array.from({ length: 9 })
            for (let c = 0; c < 3; c++)
                for (let i = 0; i < 3; i++)
                    r[c * 3 + i] = a[i] * b[c * 3] + a[3 + i] * b[c * 3 + 1] + a[6 + i] * b[c * 3 + 2]
            return r
        },
        rx = (t) => {
            const c = Math.cos(t),
                s = Math.sin(t)
            return [1, 0, 0, 0, c, s, 0, -s, c]
        },
        ry = (t) => {
            const c = Math.cos(t),
                s = Math.sin(t)
            return [c, 0, -s, 0, 1, 0, s, 0, c]
        },
        rz = (t) => {
            const c = Math.cos(t),
                s = Math.sin(t)
            return [c, s, 0, -s, c, 0, 0, 0, 1]
        },
        tv = (m, v) => [
            m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
            m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
            m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
        ]
    function drawHero() {
        if (!G) return
        const { gl, u } = G
        knock = Math.max(0, knock - 0.016)
        const seal = NA ? 0 : 1 - ss(0.1, 0.27, p),
            scan = NA
                ? knock > 0
                    ? 1.35 - (1 - knock) * 2.7
                    : 9
                : idx === 2 && p > 0.45 && p < 0.7
                  ? motion
                      ? 1.25 * Math.sin(T * 0.9)
                      : 0.2
                  : 9,
            PA = NA ? 1 : ss(0.2, 0.3, p),
            open = NA ? 0 : ss(0.7, 0.92, p)
        const smoke = NA ? 0 : 1 - ss(0.42, 0.5, p),
            chk = NA ? 0 : ss(0.44, 0.54, p) * (1 - ss(0.68, 0.76, p))
        const settle = NA ? 1 : ss(0.14, 0.3, p)
        G.spin = (G.spin ?? 0) + (motion ? (T - (G.lastT ?? T)) * 0.16 * (1 - open * 0.55) : 0)
        G.lastT = T
        const sh = knock * knock * Math.sin(knock * 38) * 0.16,
            yaw = -0.42 + G.spin + pm[0] * 0.5 + sh,
            pit = 0.46 - settle * 0.26 - pm[1] * 0.28 - open * 0.06 + sh * 0.5
        const Q = mul(ry(yaw), rx(pit))
        const off = (G.r ? G.r.height / G.s : 6) * 0.72 + 2.4,
            lift = [0, open * open * off, open * -0.3],
            QL = mul(Q, mul(rz(open * -0.5), rx(open * 0.7)))
        const bc = tv(Q, [0, -0.275, 0]),
            lc0 = tv(Q, [0, 0.725 * (1 - open * 0.3), 0])
        gl.uniformMatrix3fv(u.Q, false, Q)
        gl.uniformMatrix3fv(u.QL, false, QL)
        const boxS = 1 - open * 0.3
        gl.uniform1f(u.BS, boxS)
        gl.uniform3f(u.BC, bc[0] * boxS, bc[1] * boxS, bc[2] * boxS)
        gl.uniform3f(u.LC, lc0[0] + lift[0], lc0[1] + lift[1], lc0[2] + lift[2])
        gl.uniform1f(u.T, T)
        gl.uniform1f(u.bgT, desktop() && motion ? T : 7)
        gl.uniform1f(u.seal, seal)
        gl.uniform1f(u.scan, scan)
        gl.uniform1f(u.OP, open)
        gl.uniform1f(u.smoke, smoke)
        gl.uniform1f(u.chk, chk)
        gl.uniform1f(u.PA, PA)
        gl.uniform1f(u.SHD, NA ? 0.6 : 1 - open)
        gl.uniform1f(u.L, 1)
        gl.uniform1f(u.FL, NA ? 0 : ss(0.68, 0.84, p) * (1 - ss(0.84, 0.98, p)))
        gl.uniform2f(u.M, G.mx ?? 9, G.my ?? 9)
        gl.uniform3f(u.RP, rp[0], rp[1], rp[2])
        const list = BOX.map((f, i) => {
            const fl = motion ? Math.sin(T * 0.9 + i * 1.3) * 0.018 : 0,
                row = Math.floor(i / 4),
                ang = ((i % 4) * Math.PI) / 2 + (row * Math.PI) / 3 + 0.4,
                l = tv(Q, [Math.cos(ang) * 0.62, -0.06 - row * 0.38 + fl, Math.sin(ang) * 0.62])
            const st = ss(0.02 * i, 0.5 + 0.02 * i, (open - 0.0) * 1.0),
                g = G.grid[i],
                bob = motion ? Math.sin(T * 1.1 + i) * 0.02 : 0
            const gz = 1.55 + (i % 3) * 0.18,
                gp = 5 / (5 - gz),
                x = l[0] + (g[0] / gp - l[0]) * st,
                yy = l[1] + ((g[1] + bob) / gp - l[1]) * st,
                z = l[2] + (gz - l[2]) * st,
                sc0 = 0.17,
                sc = sc0 + ((G.cell * (0.88 + (i % 3) * 0.12)) / gp - sc0) * st
            return { x, y: yy, z, sc, i, st, g }
        })
        list.slice()
            .sort((a, b) => a.z - b.z)
            .forEach((s, k) => {
                gl.uniform4f(
                    gl.getUniformLocation(G.pg || (G.pg = gl.getParameter(gl.CURRENT_PROGRAM)), `P[${k}]`),
                    s.x,
                    s.y,
                    s.z,
                    s.sc,
                )
                gl.uniform1f(gl.getUniformLocation(G.pg, `PI[${k}]`), s.i)
            })
        list.forEach((s) => {
            const b = hb[s.i],
                on = open > 0.82
            if (open > 0.001 || b._on !== on) {
                b.classList.toggle("on", on)
                const op = ss(0.76, 0.96, open).toFixed(2)
                if (b._op !== op) b.style.opacity = b._op = op
                const ps = 5 / (5 - s.z),
                    px = G.cx + s.x * G.s * ps,
                    py = G.cy - s.y * G.s * ps,
                    H = s.sc * G.s * ps,
                    w = Math.min(112, G.cw || 112)
                if (b._w !== w) {
                    b.style.width = w + "px"
                    b.style.marginLeft = -w / 2 + "px"
                    b.style.alignContent = "end"
                    b._w = w
                }
                const hh = Math.round(H * 2 + 24)
                if (b._h !== hh) b.style.height = (b._h = hh) + "px"
                b.style.transform = `translate(${px}px,${py - H}px)`
                b._on = on
                b.tabIndex = on ? 0 : -1
            }
        })
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    /* ---------- page background, desktop only ---------- */
    let B = null
    function initBG() {
        const c = $("bg"),
            gl = c.getContext("webgl2", { antialias: false, alpha: false })
        if (!gl) return
        B = { gl, c, u: prog(gl, BGF) }
        sizeBG()
    }
    function sizeBG() {
        bgDirty = true
        if (!B) return
        const page = root.classList.contains("page"),
            w = page ? innerWidth : nf.clientWidth,
            h = page ? innerHeight : nf.scrollHeight,
            sc = Math.min(1, Math.sqrt(1100000 / (w * h)))
        B.c.width = w * sc
        B.c.height = h * sc
        B.w = w
        B.h = h
        B.gl.viewport(0, 0, B.c.width, B.c.height)
        B.gl.uniform2f(B.u.RS, B.c.width, B.c.height)
        if (!motion) {
            drawBG()
            bgDirty = false
        }
    }
    function drawBG() {
        if (!B || !nf.classList.contains("bgon")) return
        const { gl, u } = B
        gl.uniform1f(u.T, motion && desktop() ? T : 7)
        gl.uniform1f(u.L, 0)
        gl.uniform1f(
            u.S,
            motion && $("v-home").classList.contains("on") ? Math.max(0, scrollY - restTop) / innerHeight : 0,
        )
        gl.uniform2f(u.M, B.mx ?? 9, B.my ?? 9)
        gl.uniform3f(u.RP, rp[0], rp[1], rp[2])
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    function ripple(cx, cy) {
        if (!B) return
        const r = $("bg").getBoundingClientRect(),
            m = Math.min(r.width, r.height)
        rp = [(cx - r.left - r.width / 2) / m, -(cy - r.top - r.height / 2) / m, 0]
    }
    nf.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch" || !motion) return
        const hero = stick.getBoundingClientRect()
        if (G && G.r && hero.width) {
            const r = hero,
                m = Math.min(r.width, r.height)
            G.mx = (e.clientX - r.left - r.width / 2) / m
            G.my = -(e.clientY - r.top - r.height / 2) / m
            pmT = [(e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5]
        }
        if (B) {
            const r = B.c.getBoundingClientRect(),
                m = Math.min(r.width, r.height)
            B.mx = (e.clientX - r.left - r.width / 2) / m
            B.my = -(e.clientY - r.top - r.height / 2) / m
        }
    })
    /* ---------- the week ---------- */
    const DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    const SC = [
        [
            3.2,
            "auto",
            [
                ["bad", "xX_deals", "free nitro here spam.example"],
                ["bad", "xX_deals", "free nitro here spam.example"],
                ["bad", "xX_deals", "free nitro here spam.example"],
                ["r", "NeonFlux", "Removed them and logged it"],
            ],
        ],
        [
            18.67,
            "wel",
            [
                ["n", "", "Riley joined the server"],
                ["r", "NeonFlux", "Welcome Riley! Here's where to start"],
                ["c", "", ["Read the rules", "Pick your roles", "Say hello"]],
            ],
        ],
        [
            38.08,
            "ver",
            [
                ["n", "", "A new account arrives"],
                ["n", "", "Verification: Waiting for the check"],
                ["r", "NeonFlux", "Passed. They can talk now"],
            ],
        ],
        [
            45.5,
            "roles",
            [
                ["m", "Ana", "Can someone give me the artist role?"],
                ["m", "Mod", "You can pick it yourself on the website"],
                ["n", "", "Ana claimed Artist"],
            ],
        ],
        [
            59.25,
            "tic",
            [
                ["m", "Ben", "!ticket open"],
                ["r", "NeonFlux", "Ticket opened. Only you and staff can see this"],
                ["n", "", "Support replied two minutes later"],
            ],
        ],
        [
            71.83,
            "mod",
            [
                ["m", "Mod", "!mod warn @Sam don't post invite links"],
                [
                    "r",
                    "NeonFlux",
                    "Case #41: Warning of @Sam succeeded. Member notified by DM. Warning limit reached, see case #42",
                ],
            ],
        ],
        [
            81,
            "msg",
            [
                ["n", "", "Written last Tuesday"],
                ["r", "NeonFlux", "Season 3 starts Saturday. Bring friends"],
                ["n", "", "Published at 09:00"],
            ],
        ],
        [
            91.33,
            "help",
            [
                ["m", "Lea", "How do I link my account?"],
                ["m", "Mod", "!answer link-account"],
                ["r", "NeonFlux", "Saved answer posted"],
                ["m", "Lea", "!solved"],
            ],
        ],
        [
            113.5,
            "eve",
            [
                ["n", "", "Game night: 14 going"],
                ["r", "NeonFlux", "Game night starts in 30 minutes"],
            ],
        ],
        [
            117.17,
            "voi",
            [
                ["n", "", "Sam joined Join to create"],
                ["r", "NeonFlux", "Moved Sam into Sam's room"],
            ],
        ],
        [135.5, "msg", [["r", "NeonFlux", "Neonsy is live on Twitch"]]],
        [156, "lev", [["r", "NeonFlux", "Ana reached level 20 and earned the Regular role"]]],
        [164.25, "pro", [["n", "", "Ben shared a new build on the showcase"]]],
    ]
    const SAY = [
        "Someone floods a channel with links at 3 in the morning. Automod removes them before you wake up",
        "Someone new joins and gets a greeting and a short checklist",
        "A new account has to pass a check before it can talk",
        "Someone wants a role. They claim it on the website instead of asking a mod",
        "A member opens a ticket and talks to staff in private",
        "A member gets one warning too many and is timed out automatically",
        "Your announcement goes out when you scheduled it",
        "Staff post a saved answer with one command",
        "A reminder goes out before game night",
        "People join one voice channel and each gets a room of their own",
        "You go live on Twitch and the server gets an alert",
        "An active member levels up and earns a reward role automatically",
        "A member shares what they made on their own page",
    ]
    let wVis0 = 0
    const rail = $("rail"),
        feed = $("feed"),
        fea = $("fea")
    let wt = 0,
        wi = -1,
        wHold = 0,
        wPlay = true,
        wVis = false,
        lineT = []
    SC.forEach((s) => {
        const d = document.createElement("div")
        d.className = "dt"
        d.style.left = (s[0] / 168) * 100 + "%"
        rail.append(d)
        s.el = d
    })
    DAY.forEach((d, i) => {
        const e = document.createElement("div")
        e.className = "dy"
        e.style.left = (i / 7) * 100 + "%"
        e.textContent = d.slice(0, 3)
        rail.append(e)
    })
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    function wClock() {
        const h = wt % 24,
            d = Math.floor(wt / 24) % 7
        $("cday").textContent = DAY[d]
        $("ctime").textContent =
            String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.floor((h % 1) * 60)).padStart(2, "0")
        rail.style.setProperty("--w", wt / 168)
        rail.setAttribute("aria-valuenow", Math.round(wt))
        const sun = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI))
        $("wk").style.setProperty("--sun", sun.toFixed(2))
    }
    function scene(i, box, instant) {
        lineT.forEach(clearTimeout)
        lineT = []
        const s = SC[i]
        box.innerHTML = "<small>Example</small>"
        let at = 120
        s[2].forEach((l) => {
            const add = () => {
                const e = document.createElement("div")
                if (l[0] === "c") {
                    e.className = "ln r"
                    e.innerHTML = l[2].map((t) => `<span class="chk"><i></i>${esc(t)}</span>`).join("")
                    box.append(e)
                    ;[...e.children].forEach((c, k) =>
                        instant
                            ? c.classList.add("on")
                            : lineT.push(setTimeout(() => c.classList.add("on"), 500 + k * 520)),
                    )
                    return
                }
                e.className = "ln " + (l[0] === "m" ? "" : l[0])
                e.innerHTML = (l[1] ? `<b>${esc(l[1])}</b>` : "") + esc(l[2])
                box.append(e)
                if (l[0] === "bad" && instant) e.classList.add("hit2")
                if (l[0] === "bad" && !instant) {
                    lineT.push(setTimeout(() => e.classList.add("hit2"), 1250))
                    lineT.push(setTimeout(() => e.classList.add("gone"), 1850))
                }
            }
            if (instant) add()
            else lineT.push(setTimeout(add, at))
            at += l[0] === "bad" ? 230 : 640
        })
    }
    function wShow(i, instant) {
        wi = i
        const s = SC[i],
            f = byK[s[1]]
        SC.forEach((x, k) => {
            x.el.classList.toggle("done", x[0] <= s[0])
            x.el.classList.toggle("now", k === i)
        })
        fea.innerHTML = `<img src="${art(f.k)}" alt=""><div><a href="${featurePath(f)}">${s[1] === "msg" && i === 10 ? "Live alerts" : f.n}</a><p>${SAY[i]}</p></div>`
        scene(i, feed, instant || !motion)
    }
    function wStep(dt) {
        if (!wPlay || !wVis || !motion) return
        if (wHold > 0) {
            wHold -= dt
            return
        }
        const next = SC[(wi + 1) % SC.length]
        let rate = 3.2
        wt += rate * dt
        if (wi === SC.length - 1 && wt >= 168) {
            wt = 0
            wi = -1
            SC.forEach((x) => x.el.classList.remove("done", "now"))
            return
        }
        if (wi < SC.length - 1 && wt >= next[0]) {
            wt = next[0]
            wShow(wi + 1)
            wHold = Math.max(3.1, next[2].length * 0.95 + 0.8)
        }
        wClock()
    }
    function wSeek(e) {
        const r = rail.getBoundingClientRect(),
            h = Math.max(0, Math.min(168, ((e.clientX - r.left) / r.width) * 168))
        let best = 0,
            bd = 1e9
        SC.forEach((s, i) => {
            const d = Math.abs(s[0] - h)
            if (d < bd) {
                bd = d
                best = i
            }
        })
        wt = SC[best][0]
        wShow(best)
        wHold = 3.4
        wClock()
    }
    let drag = false
    rail.addEventListener("pointerdown", (e) => {
        drag = true
        rail.setPointerCapture(e.pointerId)
        wSeek(e)
    })
    rail.addEventListener("pointermove", (e) => {
        if (drag) {
            const r = rail.getBoundingClientRect(),
                h = ((e.clientX - r.left) / r.width) * 168
            const c = SC.findIndex((s) => Math.abs(s[0] - h) < 2.5)
            if (c >= 0 && c !== wi) wSeek(e)
        }
    })
    rail.addEventListener("pointerup", () => (drag = false))
    rail.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault()
            const n = (wi + (e.key === "ArrowRight" ? 1 : -1) + SC.length) % SC.length
            wt = SC[n][0]
            wShow(n)
            wHold = 3.4
            wClock()
        }
    })
    $("wkp").addEventListener("click", () => {
        wPlay = !wPlay
        $("wkp").textContent = wPlay ? "Pause" : "Play"
    })
    wt = SC[0][0]
    wShow(0, true)
    wClock()
    wi = 0
    wHold = 2
    /* ---------- parts and proof ---------- */
    const FM = {
        mod: "Warnings, timeouts, bans and cases",
        auto: "Spam, scam links and banned words",
        guard: "Anti-nuke, lockdown and jail",
        roles: "Members pick their own",
        ver: "A check before members get in",
        wel: "Greetings and a newcomer checklist",
        tic: "Private help from staff",
        help: "Saved answers and member ideas",
        lev: "Levels and reward roles",
        eve: "RSVPs and reminders",
        pro: "A page for each member",
        msg: "Scheduled posts and live alerts",
        voi: "Temporary rooms for groups",
    }
    $("fml").innerHTML = FE.map(
        (f) =>
            `<li><a href="${featurePath(f)}" data-k="${f.k}"><img src="${art(f.k)}" alt="" loading="lazy"><span><b>${f.n}</b><small>${FM[f.k]}</small></span></a></li>`,
    ).join("")
    const fm = $("fm"),
        fmb = $("fmb"),
        fmp = $("fmp"),
        fms = $("fms")
    const fmOpen = () => fmb.getAttribute("aria-expanded") === "true"
    let fmPointer = false,
        fmIn = 0,
        fmOut = 0
    function fmSet(on, focusBack) {
        clearTimeout(fmIn)
        clearTimeout(fmOut)
        if (!on) fmPointer = false
        if (on === fmOpen()) return
        fmp.hidden = !on
        fmb.setAttribute("aria-expanded", String(on))
        fms.classList.toggle("on", on)
        if (on) {
            document.querySelector(".top").classList.remove("hide")
            const here = pageFeature() ?? ""
            fmp.querySelectorAll("a").forEach((a) =>
                a.dataset.k === here ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"),
            )
        }
        if (focusBack) fmb.focus()
    }
    fm.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch" || !matchMedia("(hover:hover)").matches) return
        clearTimeout(fmOut)
        if (fmOpen()) return
        fmIn = setTimeout(() => {
            fmPointer = true
            fmSet(true)
        }, 50)
    })
    fm.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "touch") return
        clearTimeout(fmIn)
        if (!fmPointer || !fmOpen()) return
        fmOut = setTimeout(() => {
            if (!fm.contains(document.activeElement)) fmSet(false)
        }, 180)
    })
    fmb.addEventListener("click", () => fmSet(!fmOpen()))
    fms.addEventListener("pointerdown", () => fmSet(false))
    fmp.addEventListener("click", (e) => {
        if (e.target.closest("a")) fmSet(false)
    })
    fm.addEventListener("focusout", (e) => {
        if (!fm.contains(e.relatedTarget)) fmSet(false)
    })
    fm.addEventListener("keydown", (e) => {
        const items = [...fmp.querySelectorAll("a")],
            i = items.indexOf(document.activeElement),
            cols = getComputedStyle($("fml")).gridTemplateColumns.split(" ").length
        if (e.key === "Escape" && fmOpen()) {
            e.preventDefault()
            fmSet(false, true)
        } else if (e.target === fmb && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault()
            fmSet(true)
            items[e.key === "ArrowDown" ? 0 : items.length - 1].focus()
        } else if (i >= 0) {
            const to = {
                ArrowDown: i + cols,
                ArrowUp: i - cols,
                ArrowRight: i + 1,
                ArrowLeft: i - 1,
                Home: 0,
                End: items.length - 1,
            }[e.key]
            if (to === undefined) return
            e.preventDefault()
            items[(to + items.length) % items.length].focus()
        }
    })
    const LIVE = {
        "09-logs-scroll": [
            ["outline", null],
            ["bracket", null],
            ["paper", { y: 6, turn: 1.2, seconds: 5.9, around: [1100, 500] }],
            ["top-roll", null],
        ],
        "10-testing-flask": [
            ["outline", null],
            ["flask", null],
            ["water", { x: 8, turn: 1, seconds: 4.4, around: [1030, 1650] }],
            ["check", { y: -16, turn: 2.5, seconds: 5.3, around: [1025, 1220] }],
            ["glass", null],
            ["stopper", { y: -5, turn: 2, seconds: 6.1, around: [1024, 420] }],
        ],
        "04-toolbox": [
            ["outline", null],
            ["lid", { turn: -1.6, seconds: 7.3, around: [1200, 1000] }],
            ["box", null],
            ["wrench", { y: -8, turn: 5, seconds: 4.7, around: [950, 1120] }],
            ["vial", { y: -14, turn: -3.5, seconds: 5.9, around: [1300, 1200] }],
            ["front", null],
        ],
        "12-data-database": [
            ["outline", null],
            ["base", null],
            ["bottom", { y: 6, seconds: 6.3 }],
            ["third", { y: -7, seconds: 5.1 }],
            ["second", { y: 8, seconds: 7.2 }],
            ["top", { y: -9, seconds: 4.7 }],
            ["stars", { kind: "pulse", seconds: 3.1 }],
        ],
        "39-support-lifebuoy": [
            ["outline", null],
            ["ring", null],
            ["knot", { turn: 6, seconds: 4.9, around: [1034, 1650] }],
        ],
        "13-events-bell": [
            ["outline", null],
            ["bell", null],
            ["clapper", { turn: 9, seconds: 2.7, around: [966, 1344] }],
            ["rim", null],
            ["bolt", { y: -8, turn: 4, seconds: 3.9, around: [1487, 868] }],
        ],
        "32-announce-megaphone": [
            ["outline", null],
            ["waves", { kind: "pulse", seconds: 1.9 }],
            ["horn", null],
        ],
    }
    const lv = (n, cls) =>
        `<div class="lv ${cls || ""}" aria-hidden="true">${LIVE[n]
            .map(([name, m]) => {
                if (!m) return `<img src="/art/parts/${n}/${name}.webp" alt="">`
                if (m.kind === "pulse")
                    return `<img data-m="pulse" style="--sec:${m.seconds}s" src="/art/parts/${n}/${name}.webp" alt="">`
                const a = m.around || [1024, 1024]
                return `<img data-m="sway" style="--sec:${m.seconds}s;--ox:${a[0] / 20.48}%;--oy:${a[1] / 20.48}%;--dx:${(m.x || 0) / 20.48}%;--dy:${(m.y || 0) / 20.48}%;--turn:${m.turn || 0}deg" src="/art/parts/${n}/${name}.webp" alt="">`
            })
            .join("")}</div>`
    $("pf").innerHTML = [
        [
            "09-logs-scroll",
            "The code",
            "You can read every line on GitHub",
            "Open the code",
            R + "/tree/main/projects/bot/src",
        ],
        [
            "10-testing-flask",
            "The tests",
            "Anyone can run the same checks the project runs",
            "How to run them",
            R + "/blob/main/docs/CONTRIBUTING.md",
        ],
        [
            "04-toolbox",
            "The license",
            "Apache 2.0, so you can change any part and keep your changes to yourself",
            "The license",
            R + "/blob/main/LICENSE",
        ],
        [
            "12-data-database",
            "The export",
            "Export your server's data as a file other bots can load",
            "The export",
            "/docs/features/backup/",
        ],
    ]
        .map(
            (p, i) =>
                `<div class="pfi rv" style="transition-delay:${i * 0.09}s">${lv(p[0])}<h3>${p[1]}</h3><p>${p[2]}</p><a href="${p[4]}">${p[3]}</a></div>`,
        )
        .join("")
    $("cg").innerHTML = FE.map(
        (f) => `<a class="cp" href="${featurePath(f)}"><img src="${art(f.k)}" alt=""><span>${f.n}</span></a>`,
    ).join("")
    const io = new IntersectionObserver(
        (es) =>
            es.forEach((e) => {
                if (e.isIntersecting) {
                    e.target.classList.add("in")
                    if (e.target._run) e.target._run()
                }
            }),
        { threshold: 0.2 },
    )
    const watch = () => document.querySelectorAll(".rv,.auto").forEach((e) => io.observe(e))
    watch()
    new IntersectionObserver((es) => {
        wVis = es[0].isIntersecting
        if (wVis && !wVis0 && motion) {
            wVis0 = 1
            wShow(0)
            wHold = 3.6
        }
    }).observe($("wk"))
    new IntersectionObserver(
        (es) => {
            visible = es[0].isIntersecting
            canvas.style.visibility = visible ? "" : "hidden"
        },
        { rootMargin: "-2px 0px -2px 0px" },
    ).observe(stick)
    /* ---------- feature pages ---------- */
    function demoBlock() {
        return `<section class="sec"><p class="exm">Example</p><div class="dm" id="dm"></div></section>`
    }
    const HUES = {
        You: 250,
        Riley: 200,
        Mia: 280,
        Ben: 220,
        Lea: 300,
        Mod: 265,
        Support: 265,
        Sam: 230,
        xX_deals: 340,
        Alex: 190,
    }
    const M = (b, who, t, c) => {
        const e = document.createElement("div"),
            bot = who === "NeonFlux"
        e.className = "m " + (c || "")
        e.innerHTML =
            (who
                ? `<i class="av${bot ? " bot" : ""}" style="--h:${HUES[who] ?? 240}">${bot ? '<img src="/art/neonflux-bot.webp" alt="">' : esc(who[0])}</i>`
                : "") + `<div>${who ? `<b>${esc(who)}${bot ? "<em>Bot</em>" : ""}</b>` : ""}<span>${t}</span></div>`
        b.append(e)
        b.scrollTop = b.scrollHeight
        return e
    }
    const later = (fn, ms) => (motion ? setTimeout(() => fn(), ms) : fn())
    function room(d, k, task, ctrl, head, body) {
        d.className = "dm dm2"
        d.innerHTML = `<div class="dc"><p class="dtask">${task}</p>${ctrl}<button class="again" id="dag">Start again</button></div><div class="cw"><div class="cwh">${head}</div><div class="cwb" id="dlg">${body || ""}</div></div>`
        $("dag").onclick = () => DEMO[k](d)
        return $("dlg")
    }
    function steps(d, k, task, head, seed, list) {
        const lg = room(
            d,
            k,
            task,
            `<ol class="dsteps">${list.map((x) => `<li data-n="${list.indexOf(x) + 1}">${x[0]}</li>`).join("")}</ol><button class="main" id="dgo"></button>`,
            head,
        )
        seed.forEach((x) => M(lg, x[0], x[1], x[2]))
        let i = 0
        const go = $("dgo"),
            items = [...d.querySelectorAll(".dsteps li")],
            paint = () => {
                items.forEach((el, n) => {
                    el.classList.toggle("done", n < i)
                    el.classList.toggle("now", n === i)
                })
                go.textContent = i < list.length ? list[i][1] : "Done"
                go.disabled = i >= list.length
            }
        paint()
        go.onclick = () => {
            const cur = list[i]
            i++
            paint()
            if (cur[3]) {
                d.querySelector(".cwh").innerHTML = cur[3]
                lg.innerHTML = ""
            }
            cur[2].forEach((x, n) => later(() => $("dlg") === lg && M(lg, x[0], x[1], x[2]), n * 420))
        }
    }
    const DEMO = {
        auto(d) {
            const lg = room(
                d,
                "auto",
                "Someone posts a blocked link. Choose what Automod does, then post it",
                '<p class="drule">Rule: Block links to <code>spam.example</code></p><div class="row seg" role="group" aria-label="Automod mode"><button id="mE" aria-pressed="true">Enforce</button><button id="mD" aria-pressed="false">Dry run</button></div><button class="main" id="dgo">Post the link</button>',
                "<span>#</span> general",
            )
            M(lg, "Mia", "Anyone up for a match tonight?")
            M(lg, "Ben", "I'm in after dinner")
            M(lg, "Lea", "Same here, save me a spot")
            let dry = false
            const set = (v) => {
                dry = v
                $("mE").setAttribute("aria-pressed", String(!v))
                $("mD").setAttribute("aria-pressed", String(v))
            }
            $("mE").onclick = () => set(false)
            $("mD").onclick = () => set(true)
            $("dgo").onclick = () => {
                const e = M(lg, "xX_deals", "free nitro here spam.example")
                later(() => {
                    if (dry)
                        M(lg, "NeonFlux", "Dry run: This would be removed. Nothing was touched, and it's in the log")
                    else {
                        e.classList.add("struck")
                        M(lg, "NeonFlux", "Removed the message from xX_deals and logged it")
                    }
                }, 500)
            }
        },
        guard(d) {
            const lg = room(
                d,
                "guard",
                "An account starts deleting channels. Choose how anti-nuke is set and whose account it is, then run it",
                '<div class="row seg" role="group" aria-label="Anti-nuke mode"><button id="mD" aria-pressed="true">Dry run</button><button id="mE" aria-pressed="false">Enforce</button></div><div class="row seg" role="group" aria-label="Whose account"><button id="wS" aria-pressed="true">A moderator</button><button id="wO" aria-pressed="false">The owner</button></div><button class="main" id="dgo">Run it</button>',
                "<span>#</span> staff-log",
            )
            let enforce = false,
                owner = false,
                running = false
            const pick = (on, off, value) => {
                on.setAttribute("aria-pressed", "true")
                off.setAttribute("aria-pressed", "false")
                return value
            }
            $("mD").onclick = () => (enforce = pick($("mD"), $("mE"), false))
            $("mE").onclick = () => (enforce = pick($("mE"), $("mD"), true))
            $("wS").onclick = () => (owner = pick($("wS"), $("wO"), false))
            $("wO").onclick = () => (owner = pick($("wO"), $("wS"), true))
            $("dgo").onclick = () => {
                if (running) return
                running = true
                const who = owner ? "Riley, the owner," : "Sam"
                M(lg, "", `${who} deleted #general`, "sys")
                later(() => M(lg, "", `${who} deleted #help`, "sys"), 350)
                later(() => M(lg, "", `${who} deleted #memes`, "sys"), 700)
                later(() => {
                    running = false
                    if (owner)
                        M(lg, "NeonFlux", "Alert only: I can't act on the server owner, so staff need to step in")
                    else if (enforce)
                        M(
                            lg,
                            "NeonFlux",
                            "Took Sam's roles with dangerous permissions. !antinuke restore gives those back",
                        )
                    else M(lg, "NeonFlux", "Dry run: Recorded and staff told. Nothing was touched")
                }, 1100)
            }
        },
        ver(d) {
            const lg = room(
                d,
                "ver",
                "Drag the spark into the ring. The real check is harder and moves",
                '<div class="spk" id="spk"><b style="left:82%;top:50%"></b><i id="spark" tabindex="0" role="application" aria-label="Spark. Drag it, or use the arrow keys, to reach the ring" style="left:12%;top:50%"></i></div><button class="alt" id="dhelp">I can\'t use motion</button>',
                "<span>#</span> verify",
            )
            M(lg, "", "Riley joined the server", "sys")
            M(lg, "NeonFlux", "Welcome, Riley. Pass the check to see the rest of the server")
            M(lg, "", "Riley can only see this channel for now", "sys")
            const a = $("spk"),
                s = $("spark")
            let x = 0.12,
                y = 0.5,
                done = false,
                dr = false
            const put = () => {
                s.style.left = x * 100 + "%"
                s.style.top = y * 100 + "%"
                const r = a.getBoundingClientRect()
                if (!done && Math.hypot((x - 0.82) * r.width, (y - 0.5) * r.height) < 26) {
                    done = true
                    M(lg, "NeonFlux", "Verified, Riley. You now have the Member role")
                }
            }
            s.addEventListener("pointerdown", (e) => {
                dr = true
                s.setPointerCapture(e.pointerId)
            })
            s.addEventListener("pointermove", (e) => {
                if (!dr) return
                const r = a.getBoundingClientRect()
                x = Math.max(0.03, Math.min(0.97, (e.clientX - r.left) / r.width))
                y = Math.max(0.1, Math.min(0.9, (e.clientY - r.top) / r.height))
                put()
            })
            s.addEventListener("pointerup", () => (dr = false))
            s.addEventListener("keydown", (e) => {
                const k = {
                    ArrowLeft: [-0.03, 0],
                    ArrowRight: [0.03, 0],
                    ArrowUp: [0, -0.06],
                    ArrowDown: [0, 0.06],
                }[e.key]
                if (k) {
                    e.preventDefault()
                    x = Math.max(0.03, Math.min(0.97, x + k[0]))
                    y = Math.max(0.1, Math.min(0.9, y + k[1]))
                    put()
                }
            })
            $("dhelp").onclick = () => M(lg, "NeonFlux", "No problem. Ask staff here and they can let you in")
        },
        wel(d) {
            const it = [
                ["Read the rules", ["", "Riley read the rules", "sys"]],
                ["Pick your roles", ["", "Riley picked Game nights", "sys"]],
                ["Say hello", ["Riley", "Hello everyone!"]],
            ]
            const lg = room(
                d,
                "wel",
                "You're Riley, and you just joined. Tick off the list",
                `<div class="chk2">${it.map((t) => `<button aria-pressed="false"><i></i>${String(t[0])}</button>`).join("")}</div><div class="bar2"><i id="wb"></i></div>`,
                "<span>#</span> welcome",
            )
            M(lg, "", "Riley joined the server", "sys")
            M(lg, "Mia", "Hi Riley, good to have you")
            M(lg, "NeonFlux", "Welcome, Riley! Here's where to start: Read the rules, pick your roles and say hello")
            const bs = [...d.querySelectorAll(".chk2 button")]
            let said = false
            bs.forEach((b, i) => {
                b.onclick = () => {
                    if (b.getAttribute("aria-pressed") === "true") return
                    b.setAttribute("aria-pressed", "true")
                    M(lg, it[i][1][0], it[i][1][1], it[i][1][2])
                    const n = bs.filter((x) => x.getAttribute("aria-pressed") === "true").length
                    $("wb").style.setProperty("--v", (n / 3) * 100 + "%")
                    if (n === 3 && !said) {
                        said = true
                        later(() => M(lg, "NeonFlux", "That's everything, Riley. You're all set"), 400)
                    }
                }
            })
        },
        tic(d) {
            steps(
                d,
                "tic",
                "Riley needs help from staff",
                "<span>#</span> general",
                [
                    ["Mia", "Anyone seen the new event?"],
                    ["Riley", "My role disappeared, who can help?"],
                    ["Mod", "Open a ticket so we can look at it privately"],
                ],
                [
                    [
                        "Ask for a ticket",
                        "Send !ticket open",
                        [
                            ["Riley", "<code>!ticket open</code>"],
                            ["NeonFlux", "The questions are in your DMs, Riley"],
                        ],
                    ],
                    [
                        "Answer in your DMs",
                        "Answer the question",
                        [
                            ["NeonFlux", "What do you need help with?"],
                            ["Riley", "My Member role is gone"],
                            [
                                "NeonFlux",
                                "That's every question. Send <code>!ticket submit 1 private</code> to open it",
                            ],
                        ],
                        "Direct message with NeonFlux",
                    ],
                    [
                        "Open it privately",
                        "Send it to staff",
                        [
                            ["Riley", "<code>!ticket submit 1 private</code>"],
                            ["NeonFlux", "Ticket opened. Only you and support can see it"],
                        ],
                    ],
                    [
                        "Staff reply",
                        "Let staff reply",
                        [
                            ["Support", "Fixed it. Can you check?"],
                            ["Riley", "It's back, thanks!"],
                        ],
                        "<span>#</span> ticket-riley",
                    ],
                    [
                        "Close it",
                        "Send !ticket close",
                        [
                            ["Riley", "<code>!ticket close</code>"],
                            ["NeonFlux", "Ticket closed, and the transcript is saved"],
                        ],
                    ],
                ],
            )
        },
        help(d) {
            steps(
                d,
                "help",
                "Lea asks something staff have answered before. Post the saved answer",
                "<span>#</span> help-forum",
                [
                    ["Lea", "How do I link my account?"],
                    ["NeonFlux", "Thanks for posting, Lea. Someone will be with you soon"],
                    ["Ben", "I was going to ask the same thing"],
                ],
                [
                    [
                        "Staff post a saved answer",
                        "Send !answer link-account",
                        [
                            ["Mod", "<code>!answer link-account</code>"],
                            ["NeonFlux", "Open Settings, then Accounts, then press Link"],
                        ],
                    ],
                    [
                        "Lea closes the post",
                        "Send !solved",
                        [
                            ["Lea", "<code>!solved</code>"],
                            ["NeonFlux", "Marked as solved and closed"],
                        ],
                    ],
                ],
            )
        },
        lev(d) {
            let xp = 1570
            const lg = room(
                d,
                "lev",
                "You're nearly at level 4, which earns a role. Send a message",
                '<div class="rank"><b id="lv">Level 3</b><span id="lx"></span><div class="bar2"><i id="lb"></i></div></div><button class="main" id="dgo">Send a message</button>',
                "<span>#</span> general",
            )
            M(lg, "Mia", "Good game last night")
            M(lg, "Ben", "That last round was close")
            M(lg, "You", "Same time this week?")
            const say = ["I'll bring the snacks", "Who's hosting?", "See you all then", "Count me in"]
            let n = 0
            const up = () => {
                const l = Math.floor(Math.sqrt(xp / 100)),
                    a = 100 * l * l,
                    b = 100 * (l + 1) * (l + 1)
                $("lv").textContent = "Level " + l
                $("lx").textContent = `${xp - a} of ${b - a} XP to level ${l + 1}`
                $("lb").style.setProperty("--v", ((xp - a) / (b - a)) * 100 + "%")
            }
            up()
            $("dgo").onclick = () => {
                const was = Math.floor(Math.sqrt(xp / 100))
                xp += 15
                M(lg, "You", say[n++ % say.length])
                up()
                const l = Math.floor(Math.sqrt(xp / 100))
                if (l > was) later(() => M(lg, "NeonFlux", `You reached level ${l} and earned the Regular role`), 300)
            }
        },
        eve(d) {
            const lg = room(
                d,
                "eve",
                "Say whether you're coming, then jump ahead to the reminder",
                '<div class="evc"><b>Game night</b><span>Saturday, 20:00 Berlin time</span><span>Bring your own snacks</span></div><div class="row seg" role="group" aria-label="Your answer"><button data-v="going" aria-pressed="false">Going</button><button data-v="maybe" aria-pressed="false">Maybe</button><button data-v="not-going" aria-pressed="false">Not going</button></div><div class="who" id="who"></div><button class="alt" id="dgo">Jump to the reminder</button>',
                "<span>#</span> events",
            )
            M(
                lg,
                "NeonFlux",
                "New event: Game night, Saturday at 20:00. Send <code>!event rsvp gamenight going</code> or <code>maybe</code>",
            )
            M(lg, "Mia", "<code>!event rsvp gamenight going</code>")
            M(lg, "Ben", "<code>!event rsvp gamenight going</code>")
            let me = null
            const base = ["Mia", "Ben", "Lea"],
                up = () => {
                    const g = me === "going" ? ["You", ...base] : base
                    $("who").innerHTML =
                        g.map((w) => `<i class="av" style="--h:${HUES[w]}" title="${w}">${w[0]}</i>`).join("") +
                        `<span>${g.length} going${me === "maybe" ? ", you might" : ""}</span>`
                }
            up()
            d.querySelectorAll(".seg button").forEach((b) => {
                b.onclick = () => {
                    me = b.dataset.v
                    d.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)))
                    up()
                    M(lg, "You", `<code>!event rsvp gamenight ${me}</code>`)
                }
            })
            $("dgo").onclick = () => {
                M(lg, "", "Saturday, 19:30", "sys")
                M(lg, "NeonFlux", "Reminder: Game night starts in 30 minutes")
            }
        },
        pro(d) {
            const lg = room(
                d,
                "pro",
                "Change Ana's page and watch",
                '<label class="sl">Bio<input type="text" id="pa" value="I build tiny robots" maxlength="120"></label><label class="sl">Link<input type="text" id="pl" value="ana.example" maxlength="60"></label><div class="row seg" role="group" aria-label="Accent colour"><button data-c="#6ea0ff" aria-pressed="true">Blue</button><button data-c="#b07fff" aria-pressed="false">Purple</button><button data-c="#ff7ac0" aria-pressed="false">Pink</button></div>',
                "Ana's page",
                '<div class="pfc" id="pfc"><i class="av big" style="--h:230">A</i><b>Ana</b><span id="pA"></span><a id="pL"></a><div class="pfm"><em>Showcase</em><div class="pfg"><i style="background-image:url(/art/neonflux-bot.webp)">Tiny robot</i><i style="background-image:url(/art/b-18-api-book.webp)">Code notebook</i><i style="background-image:url(/art/b-13-events-bell.webp)">Brass bell</i></div></div></div>',
            )
            const up = () => {
                $("pA").textContent = $("pa").value
                $("pL").textContent = $("pl").value
            }
            $("pa").oninput = up
            $("pl").oninput = up
            up()
            d.querySelectorAll(".seg button").forEach((b) => {
                b.onclick = () => {
                    d.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)))
                    lg.style.setProperty("--pc", b.dataset.c)
                }
            })
        },
        msg(d) {
            const lg = room(
                d,
                "msg",
                "Write an announcement now and let it go out later",
                '<label class="sl">Message<input type="text" id="mt" value="Season 3 starts Saturday. Bring friends" maxlength="80"></label><p class="drule">Goes to <code>#announcements</code>, Saturday at 09:00</p><button class="main" id="dgo">Schedule it</button>',
                "<span>#</span> announcements",
            )
            M(lg, "NeonFlux", "The server is moving to new rules on Monday")
            M(lg, "NeonFlux", "Patch notes are up in #updates")
            M(lg, "NeonFlux", "Season 2 ends this week. Thanks for playing")
            const go = $("dgo")
            go.onclick = () => {
                if (!go.dataset.s) {
                    go.dataset.s = "1"
                    go.dataset.t = $("mt").value
                    $("mt").disabled = true
                    go.textContent = "Jump to Saturday"
                    M(lg, "", "Announcement scheduled", "sys")
                } else {
                    go.disabled = true
                    go.textContent = "Published"
                    M(lg, "", "Saturday, 09:00", "sys")
                    M(lg, "NeonFlux", esc(go.dataset.t))
                }
            }
        },
        voi(d) {
            const owners = ["Mia", "Sam", "Ben"]
            let rooms = ["Mia", "Sam"]
            const lg = room(
                d,
                "voi",
                "People join one channel, and each gets a room of their own",
                `<button class="main" id="dgo">Ben joins</button><button class="alt" id="dex">Everyone leaves</button>`,
                "Voice channels",
            )
            lg.classList.add("vt")
            const draw = () => {
                lg.innerHTML =
                    '<div class="vc gen">Join to create</div>' +
                    rooms
                        .map(
                            (r) =>
                                `<div class="vc"><span>${esc(r + "'s room")}</span><i class="av" style="--h:${HUES[r] ?? 240}">${r[0]}</i></div>`,
                        )
                        .join("") +
                    (rooms.length ? "" : '<p class="vn">No rooms right now</p>')
            }
            draw()
            $("dgo").onclick = () => {
                if (rooms.length < 3) rooms.push(owners[rooms.length])
                $("dgo").textContent = rooms.length < 3 ? `${owners[rooms.length]} joins` : "All three have rooms"
                $("dgo").disabled = rooms.length >= 3
                draw()
            }
            $("dex").onclick = () => {
                rooms = []
                $("dgo").textContent = "Mia joins"
                $("dgo").disabled = false
                draw()
            }
        },
    }
    function modBlock() {
        return `<section class="sec pad"><p class="exm">Example</p><h2>Warn Sam and see what the limit does</h2><p class="lead">Move the numbers and press Warn Sam</p>
<div class="sim sim3"><div class="ring" id="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#6ea0ff"/><stop offset="1" stop-color="#b07fff"/></linearGradient></defs><g id="segs"></g></svg><div class="ava"><b id="sam">Sam</b><span id="samst">No warnings</span></div></div>
<div class="ctrl"><div class="slr"><label class="sl">Warnings<output id="oW">3</output><input id="iW" type="range" min="2" max="20" value="3"></label><label class="sl">In days<output id="oD">30</output><input id="iD" type="range" min="1" max="365" value="30"></label><label class="sl">Timeout<output id="oT">1 hour</output><input id="iT" type="range" min="0" max="5" value="2"></label></div><p class="say2" id="say2"></p><p class="cmd" id="cmd"></p><div class="acts"><button class="main" id="warn">Warn Sam</button><button class="again" id="reset">Start again</button></div></div><div class="cw"><div class="cwh"><span>#</span> staff-log</div><div class="cwb" id="mfeed"></div></div></div>
<div class="steps" id="steps"><div class="st">Your permission is checked first</div><div class="st">The case is saved with your reason</div><div class="st">Sam gets a DM saying why</div><div class="st">It goes to the staff log</div></div>
<div class="src"><a href="${R}/blob/main/projects/bot/src/moderation.ts">Read the code</a><a href="${R}/blob/main/projects/bot/tests/moderation.test.ts">Read the tests</a></div></section>`
    }
    function modInit() {
        const T_ = [
            ["10m", "10 minutes"],
            ["30m", "30 minutes"],
            ["1h", "1 hour"],
            ["2h", "2 hours"],
            ["1d", "1 day"],
            ["7d", "7 days"],
        ]
        let n = 0,
            cs = 41,
            out = false,
            busy = false
        const iW = $("iW"),
            iD = $("iD"),
            iT = $("iT"),
            ring = $("ring")
        const draw = () => {
            const N = +iW.value,
                C = 2 * Math.PI * 44,
                gap = N > 10 ? 1.2 : 2.4,
                len = C / N - gap
            $("segs").innerHTML = Array.from(
                { length: N },
                (_, i) =>
                    `<circle cx="50" cy="50" r="44" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-i * (C / N)}" class="${i < n ? "on" : ""}"/>`,
            ).join("")
            $("oW").textContent = N
            $("oD").textContent = iD.value
            $("oT").textContent = T_[+iT.value][1]
            $("say2").textContent =
                `A timeout of ${T_[+iT.value][1]} after ${N} warnings in ${iD.value} day${iD.value == 1 ? "" : "s"}`
            $("cmd").textContent = `!mod warn-limit ${N} ${iD.value} ${T_[+iT.value][0]}`
            $("samst").textContent = out ? `Timed out, ${out}` : n ? `${n} of ${N} warnings` : "No warnings"
        }
        const steps = [...$("steps").children]
        const say = (who, t) => M($("mfeed"), who, t)
        const seedLog = () => {
            say("NeonFlux", "Case #39: Timeout of @Alex for 10 minutes. Reason: Arguing in #general")
            say("NeonFlux", "Case #40: Warning of @Alex. Reason: Spam in #general")
            say("Mod", "Alex has been told. Keeping an eye on it")
        }
        seedLog()
        const warn = () => {
            if (busy || out) return
            busy = true
            steps.forEach((s) => s.classList.remove("on"))
            const d = motion ? 260 : 0
            steps.forEach((s, i) => setTimeout(() => s.classList.add("on"), i * d))
            setTimeout(() => {
                busy = false
                if (!$("mfeed")) return
                n++
                const hit = n >= +iW.value
                say(
                    "NeonFlux",
                    `Case #${cs}: Warning of @Sam. Reason: Spam in #general. Sam got a DM saying why${hit ? `. Warning limit reached, see case #${cs + 1}` : ""}`,
                )
                cs++
                if (hit) {
                    out = T_[+iT.value][1]
                    ring.classList.add("out")
                    say(
                        "NeonFlux",
                        `Case #${cs}: Timeout of @Sam for ${T_[+iT.value][1]}. Reason: Automatic: ${iW.value} warnings in ${iD.value} day${iD.value == 1 ? "" : "s"}`,
                    )
                    cs++
                }
                if (motion) {
                    ring.classList.remove("boom")
                    void ring.offsetWidth
                    ring.classList.add("boom")
                    const r = ring.getBoundingClientRect()
                    ripple(r.left + r.width / 2, r.top + r.height / 2)
                }
                draw()
                busy = false
                $("warn").disabled = out
                $("warn").style.opacity = out ? 0.45 : 1
            }, d * 2)
        }
        ;[iW, iD, iT].forEach((x) =>
            x.addEventListener("input", () => {
                if (+iW.value <= n && !out) n = Math.max(0, +iW.value - 1)
                draw()
            }),
        )
        $("warn").addEventListener("click", warn)
        $("reset").addEventListener("click", () => {
            n = 0
            out = false
            ring.classList.remove("out")
            $("mfeed").innerHTML = ""
            seedLog()
            steps.forEach((s) => s.classList.remove("on"))
            $("warn").disabled = false
            $("warn").style.opacity = 1
            draw()
        })
        draw()
    }
    function rolesBlock() {
        const m = [
            ["Region", "pick one", ["Europe", "Americas", "Asia"], 1],
            ["Games", "as many as you like", ["Valheim", "Factorio", "Rocket League"], 0],
        ]
        return `<section class="sec pad"><p class="exm">Example</p><h2>Claim a role</h2><p class="lead">This is the member's page on the website. Your card changes as you claim</p>
<div class="mc"><div class="me" id="me"><b>You</b><span class="mej">Member</span><div id="chips"></div></div><div class="mn">${m.map((x, i) => `<div data-s="${String(x[3])}"><h3>${String(x[0])}<small>${String(x[1])}</small></h3>${x[2].map((r) => `<div class="rl"><span>${r}</span><button data-r="${r}" data-m="${i}">Claim</button></div>`).join("")}</div>`).join("")}</div></div>
<button class="again" id="rag">Start again</button><p class="alt2">Prefer chat? Members can react to a message to get the role instead</p>
<div class="src"><a href="/docs/features/roles/#role-picker">How the picker works</a><a href="/docs/features/roles/#reaction-role-panels">How reaction panels work</a></div></section>`
    }
    function rolesInit() {
        const tc = { Europe: "#6ea0ff", Americas: "#b07fff", Asia: "#ff7ac0" }
        const chips = $("chips")
        const sync = () => {
            const on = [...document.querySelectorAll(".rl button.on")]
            chips.innerHTML = on.map((b) => `<em>${esc(b.dataset.r)}</em>`).join("")
            const reg = on.find((b) => tc[b.dataset.r])
            $("me").style.setProperty("--tc", reg ? tc[reg.dataset.r] : "#5a57e8")
        }
        $("rag").onclick = () => {
            document.querySelectorAll(".rl button.on").forEach((b) => {
                b.classList.remove("on")
                b.textContent = "Claim"
            })
            sync()
        }
        document.querySelectorAll(".rl button").forEach((b) =>
            b.addEventListener("click", () => {
                const wrap = b.closest("[data-s]"),
                    single = wrap.dataset.s === "1",
                    was = b.classList.contains("on")
                b.classList.add("wait")
                b.textContent = "Waiting"
                setTimeout(
                    () => {
                        b.classList.remove("wait")
                        if (single && !was)
                            wrap.querySelectorAll("button.on").forEach((x) => {
                                x.classList.remove("on")
                                x.textContent = "Claim"
                            })
                        b.classList.toggle("on", !was)
                        b.textContent = was ? "Claim" : "Drop"
                        sync()
                    },
                    motion ? 520 : 0,
                )
            }),
        )
    }
    function feature(k) {
        const f = byK[k]
        if (!f) return
        const i = FE.indexOf(f),
            nx = FE[(i + 1) % FE.length],
            pv = FE[(i - 1 + FE.length) % FE.length],
            v = $("v-f")
        const letters = f.n
            .split("")
            .map((c, j) => `<span style="--k:${j}">${c === " " ? "&nbsp;" : c}</span>`)
            .join("")
        v.innerHTML = `<div class="fh pad ${f.cls || "floaty"}" style="--len:${f.n.length}"><h1>${letters}</h1><p>${f.l}</p>${{ tic: "39-support-lifebuoy", eve: "13-events-bell", msg: "32-announce-megaphone" }[k] ? lv({ tic: "39-support-lifebuoy", eve: "13-events-bell", msg: "32-announce-megaphone" }[k], "ic") : `<img class="ic" src="${art(k)}" alt="">`}</div><section class="pad fdm"><div class="scnd" style="--tc:${TINT[k]}">${k === "mod" ? modBlock() : k === "roles" ? rolesBlock() : demoBlock()}</div></section>
<section class="sec pad fcv"><h2>What it covers</h2><div class="two"><div><ul class="facts">${f.f.map((x) => `<li class="rv">${esc(x)}</li>`).join("")}</ul><div class="src">${featureDocs(
            f,
        )
            .map(([href, label]) => `<a href="${href}">${label}</a>`)
            .join(
                "",
            )}${f.c ? "" : `<a href="${R}/tree/main/projects/bot/src">Read the code</a>`}</div><div class="acts" style="margin-top:18px"><a class="main" href="${dashboardUrl}">Open dashboard</a></div></div></div></section>
<nav class="nxs pad" aria-label="Other features"><a class="nx" href="${featurePath(pv)}"><img src="${art(pv.k)}" alt=""><span><small>Previous</small><b>${pv.n}</b></span></a><a class="nx nt" href="${featurePath(nx)}"><span><small>Next</small><b>${nx.n}</b></span><img src="${art(nx.k)}" alt=""></a></nav><footer class="foot pad"><strong>NeonFlux, open source under Apache 2.0</strong><a href="/docs/">Docs</a><a href="https://github.com/NeonTechSpace/NeonFlux">GitHub</a><a href="https://github.com/NeonTechSpace/NeonFlux/blob/main/docs/SECURITY.md">Security</a><p class="lgl">NeonFlux is an independent project. It is not affiliated with, endorsed by or sponsored by Fluxer</p></footer>`
        if (k === "mod") modInit()
        else if (k === "roles") rolesInit()
        else DEMO[k]($("dm"))
        watch()
        if (f.cls === "slam" && motion)
            setTimeout(() => {
                const r = v.querySelector(".ic")?.getBoundingClientRect()
                if (r) ripple(r.left + r.width / 2, r.top + r.height * 0.8)
            }, 800)
    }
    const canonical = document.querySelector('link[rel="canonical"]')
    let navLink = false,
        lastPlace = location.pathname + location.hash
    // Moving inside the page keeps the animation running, while the address stays a real one that can be shared and indexed
    const go = (place) => {
        history.pushState(null, "", place)
        route()
    }
    const placeChanged = () => {
        adoptOldLink()
        if (location.pathname + location.hash !== lastPlace) route()
    }
    function route() {
        const h = location.hash.slice(1),
            k = pageFeature(),
            na = h === "no-access",
            link = navLink
        navLink = false
        lastPlace = location.pathname + location.hash
        const shown = k ? byK[k] : null
        document.title = shown ? featureTitle(shown) : homeTitle
        document.querySelector('meta[name="description"]').content = shown ? featureDescription(shown) : homeDescription
        canonical.href = new URL(location.pathname, canonical.href).href
        const run = () => {
            const away = NA || $("v-f").classList.contains("on")
            snapState = [!k, !na]
            root.classList.toggle("snap", motion && !k && !na)
            document.querySelector(".top").classList.remove("hide")
            if (na !== NA) {
                NA = na
                nf.classList.toggle("na", na)
                $("hword").textContent = na ? "Private" : "NeonFlux"
                autoT = null
                act = -1
                if (na) {
                    $("hacts").innerHTML =
                        `<a class="main" href="/">Back to the homepage</a><a class="alt" href="/docs/self-hosting/overview/">Run your own</a>`
                    knocks = 0
                    $("knr").textContent = ""
                } else {
                    $("hacts").innerHTML =
                        `<a class="main" href="${dashboardUrl}">Open dashboard</a><a class="alt" href="/docs/self-hosting/overview/">Run your own</a>`
                }
            }
            $("v-home").classList.toggle("on", !k)
            $("v-f").classList.toggle("on", !!k)
            if (k) {
                $("stage").innerHTML = ""
                feature(k)
                window.scrollTo(0, 0)
            } else {
                $("v-f").innerHTML = ""
                if (!$("stage").firstChild) deckShow(deckK)
                if (na) window.scrollTo(0, 0)
                else if (h && h !== "home" && away && !link) window.scrollTo(0, homeY)
                else if (h && h !== "home" && $(h)) $(h).scrollIntoView()
                else if (!h || h === "home") window.scrollTo(0, homeY)
                size()
                scrollP()
                if (B) sizeBG()
            }
            snapSync()
        }
        if (document.startViewTransition && motion) {
            // A quick second move skips the first one's animation, which is fine
            document.startViewTransition(run).ready.catch(() => {})
        } else run()
    }
    addEventListener("hashchange", placeChanged)
    addEventListener("popstate", placeChanged)
    $("knock").addEventListener("click", (e) => {
        knock = 1
        $("knr").textContent = KN[knocks % KN.length]
        knocks++
        const r = stick.getBoundingClientRect()
        ripple(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2)
    })
    document.addEventListener("click", (e) => {
        const a = e.target.closest('.nf a[href="#"]')
        if (a) e.preventDefault()
        if (e.target.closest('a[href="/"]')) homeY = 0
        const inner = e.target.closest('a[href="/"], a[href^="/features/"]')
        if (inner && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
            e.preventDefault()
            navLink = true
            go(inner.getAttribute("href"))
            return
        }
        const same = e.target.closest('a[href^="#"]')
        if (same && same.getAttribute("href").length > 1) {
            navLink = true
            if (same.getAttribute("href") === location.hash) {
                e.preventDefault()
                route()
            }
        }
    })
    /* ---------- motion switch ---------- */
    /* ---------- try it ---------- */
    let deckK = "mod"
    const TINT = {
        mod: "#8b6cff",
        auto: "#4f8bff",
        guard: "#6c7cff",
        roles: "#b07fff",
        ver: "#3fb6ff",
        wel: "#9a7cff",
        tic: "#7c8cff",
        help: "#4f8bff",
        lev: "#b07fff",
        eve: "#6ea0ff",
        pro: "#4fc3e8",
        msg: "#7c6cff",
        voi: "#a06cff",
    }
    $("rail2").innerHTML = [
        ["Safety", ["mod", "auto", "guard", "ver"]],
        ["Members", ["wel", "roles", "pro"]],
        ["Support", ["tic", "help"]],
        ["Activity", ["lev", "eve", "msg", "voi"]],
    ]
        .map(
            ([t, ks]) =>
                `<div class="dg" style="--n:${ks.length}"><small>${String(t)}</small><div>${ks
                    .map(
                        (k) =>
                            `<button data-k="${k}" aria-pressed="false"><img src="${art(k)}" alt="" loading="lazy"><span>${byK[k].n}</span></button>`,
                    )
                    .join("")}</div></div>`,
        )
        .join("")
    function deckShow(k) {
        deckK = k
        const pick = $("rail2").querySelector(`button[data-k="${k}"]`)
        $("rail2").scrollLeft = pick.offsetLeft - ($("rail2").clientWidth - pick.offsetWidth) / 2
        const f = byK[k],
            st = $("stage")
        $("rail2")
            .querySelectorAll("button")
            .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)))
        const mv = { tic: "39-support-lifebuoy", eve: "13-events-bell", msg: "32-announce-megaphone" }[k]
        st.innerHTML = `<div class="scn" style="--tc:${TINT[k]}"><div class="scnd"><div class="scna">${mv ? lv(mv, "ic") : `<img src="${art(k)}" alt="">`}</div><div class="scnh"><div><h3>${f.n}</h3><p>${f.l}</p></div><a class="more" href="#f-${k}">More about ${f.n}<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a></div>${
            k === "mod" ? modBlock() : k === "roles" ? rolesBlock() : demoBlock()
        }</div></div>`
        if (k === "mod") modInit()
        else if (k === "roles") rolesInit()
        else DEMO[k]($("dm"))
        watch()
    }
    $("rail2").addEventListener("click", (e) => {
        const b = e.target.closest("button")
        if (b) deckShow(b.dataset.k)
    })
    /* ---------- the dashboard, as an example ---------- */
    const BW = [
        ["Tickets", true],
        ["Levels", false],
        ["Welcome messages", true],
        ["Automod", true],
    ]
    let bwSaved = BW.map((r) => r[1]),
        bwNow = bwSaved.slice()
    function bwDraw() {
        const dirty2 = bwNow.some((v, i) => v !== bwSaved[i])
        $("bwl").innerHTML =
            BW.map(
                (r, i) =>
                    `<div class="bwrow"><span>${r[0]}${bwNow[i] !== bwSaved[i] ? "<em>Not saved yet</em>" : ""}</span><button class="tog" role="switch" aria-label="${r[0]}" aria-checked="${bwNow[i]}" data-i="${i}"><i></i></button></div>`,
            ).join("") + `<button class="main" id="bws" ${dirty2 ? "" : "disabled"}>Save</button>`
    }
    $("bwl").addEventListener("click", (e) => {
        const t = e.target.closest(".tog")
        if (t) {
            bwNow[+t.dataset.i] = !bwNow[+t.dataset.i]
            bwDraw()
        } else if (e.target.id === "bws") {
            bwNow.forEach((v, i) => {
                if (v !== bwSaved[i]) {
                    const a = document.createElement("div")
                    a.className = "bwe"
                    a.innerHTML = `<b>You</b> changed ${BW[i][0]}<span>${bwSaved[i] ? "On" : "Off"} to ${v ? "On" : "Off"}</span>`
                    $("bwa").prepend(a)
                    while ($("bwa").children.length > 4) $("bwa").lastChild.remove()
                }
            })
            bwSaved = bwNow.slice()
            bwDraw()
        }
    })
    $("bwa").innerHTML =
        `<div class="bwe"><b>Alex</b> changed Warning limit<span>Off to On</span></div><div class="bwe"><b>Mia</b> changed Welcome messages<span>Off to On</span></div><div class="bwe"><b>Alex</b> changed Tickets<span>Off to On</span></div>`
    bwDraw()
    $("bwr").innerHTML = ["Europe", "Game nights", "Announcements"]
        .map((r) => `<button class="alt" aria-pressed="false">${r}</button>`)
        .join("")
    $("bwr").addEventListener("click", (e) => {
        const b = e.target.closest("button")
        if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"))
    })
    document.querySelector(".bwt").addEventListener("click", (e) => {
        const b = e.target.closest("button")
        if (!b) return
        document.querySelectorAll(".bwt button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)))
        document.querySelectorAll(".bwv").forEach((v) => (v.hidden = v.dataset.v !== b.dataset.v))
    })
    $("vote").addEventListener("click", (e) => {
        const on = e.target.getAttribute("aria-pressed") !== "true"
        e.target.setAttribute("aria-pressed", String(on))
        e.target.textContent = on ? "Voted" : "Vote"
    })
    document.querySelectorAll("#stp pre").forEach((pre) => {
        const codeEl = pre.querySelector("code")
        codeEl.innerHTML = codeEl.textContent
            .split("\n")
            .map((line) =>
                line
                    .split(" ")
                    .map((w, i) =>
                        i === 0
                            ? `<span class="hc">${w}</span>`
                            : w.startsWith("--")
                              ? `<span class="hf">${w}</span>`
                              : /^https?:|\//.test(w)
                                ? `<span class="hu">${w}</span>`
                                : `<span class="hs">${w}</span>`,
                    )
                    .join(" "),
            )
            .join("\n")
        const b = document.createElement("button")
        b.className = "cpy"
        b.textContent = "Copy"
        b.addEventListener("click", () => {
            navigator.clipboard
                .writeText(pre.textContent.replace(/Copy$|Copied$/, ""))
                .then(() => (b.textContent = "Copied"))
                .catch(() => (b.textContent = "Select it"))
                .finally(() => setTimeout(() => (b.textContent = "Copy"), 1500))
        })
        pre.append(b)
    })
    $("orb").innerHTML = FE.map((f, i) => {
        const t = (i / FE.length) * Math.PI * 2 + 0.26
        return `<a href="${featurePath(f)}" aria-label="${f.n}" title="${f.n}" style="left:${(50 + 45 * Math.cos(t)).toFixed(1)}%;top:${(50 + 41 * Math.sin(t)).toFixed(1)}%;--d:${(0.5 + (i % 3) * 0.5).toFixed(1)};--o:${i}"><img src="${art(f.k)}" alt="" loading="lazy"></a>`
    }).join("")
    $("end").addEventListener("pointermove", (e) => {
        if (!motion || e.pointerType === "touch") return
        const r = $("end").getBoundingClientRect()
        $("orb").style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3))
        $("orb").style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3))
    })
    function bindPill(row) {
        if (row._pill) return
        const pill = document.createElement("i")
        pill.className = "pill"
        pill.setAttribute("aria-hidden", "true")
        row.prepend(pill)
        row._pill = pill
        const place = () => {
            const on = row.querySelector('button[aria-pressed="true"]')
            row.classList.toggle("haspill", !!on)
            if (!on || !on.offsetWidth) return
            pill.style.width = on.offsetWidth + "px"
            pill.style.height = on.offsetHeight + "px"
            pill.style.transform = `translate(${on.offsetLeft}px,${on.offsetTop}px)`
        }
        place()
        pill.getBoundingClientRect()
        pill.classList.add("go")
        new MutationObserver(place).observe(row, {
            subtree: true,
            attributes: true,
            attributeFilter: ["aria-pressed"],
        })
        new ResizeObserver(place).observe(row)
    }
    const bindPills = () => document.querySelectorAll(".dock,.bwt,.seg:not(.multi)").forEach(bindPill)
    $("tbk").innerHTML = lv("12-data-database")
    document.addEventListener("click", (e) => {
        if (!motion) return
        const b = e.target.closest(".scnd .main,.scnd .chk2 button,.scnd .rl button")
        const pn = b && b.closest(".scnd")
        if (!pn) return
        pn.classList.remove("sw")
        void pn.offsetWidth
        pn.classList.add("sw")
        const key = pageFeature() ?? deckK,
            obj = pn.querySelector(".scna > *") || document.querySelector("#v-f .fh .ic"),
            kind =
                {
                    mod: "strike",
                    auto: "strike",
                    ver: "strike",
                    eve: "swing",
                    msg: "swing",
                    voi: "swing",
                    lev: "swing",
                    tic: "spin",
                }[key] || "lift"
        if (obj) {
            obj.classList.remove("act-strike", "act-swing", "act-spin", "act-lift")
            void obj.offsetWidth
            obj.classList.add("act-" + kind)
        }
    })
    {
        const tile = (size, n, r, alpha) => {
            const cv = document.createElement("canvas")
            cv.width = cv.height = size
            const x = cv.getContext("2d")
            for (let i = 0; i < n; i++) {
                x.fillStyle = `rgba(190,205,255,${alpha * (0.5 + Math.random() / 2)})`
                x.beginPath()
                x.arc(Math.random() * size, Math.random() * size, r * (0.6 + Math.random() * 0.8), 0, 7)
                x.fill()
            }
            return `url(${cv.toDataURL()})`
        }
        const dust = $("dust")
        dust.style.backgroundImage = `${tile(620, 26, 1.3, 0.42)},${tile(1100, 18, 2.4, 0.13)}`
        let queued = false
        addEventListener(
            "scroll",
            () => {
                if (queued || !motion) return
                queued = true
                requestAnimationFrame(() => {
                    queued = false
                    dust.style.backgroundPosition = `0 ${-scrollY * 0.09}px,120px ${-scrollY * 0.03}px`
                })
            },
            { passive: true },
        )
    }
    {
        const items = [...document.querySelectorAll("#faq details")]
        const shut = (d, instant) => {
            if (!d.open) return
            const p = d.querySelector("p")
            d.classList.remove("on")
            if (instant || !motion) return void (d.open = false)
            const a = p.animate(
                [
                    { height: p.offsetHeight + "px", opacity: 1 },
                    { height: 0, opacity: 0, paddingBottom: 0 },
                ],
                { duration: 220, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
            )
            a.onfinish = () => {
                if (!d.classList.contains("on")) d.open = false
            }
        }
        items.forEach((d) =>
            d.querySelector("summary").addEventListener("click", (e) => {
                e.preventDefault()
                if (d.classList.contains("on")) return shut(d)
                items.filter((o) => o !== d).forEach((o) => shut(o))
                d.open = true
                d.classList.add("on")
                if (!motion) return
                const p = d.querySelector("p")
                p.animate(
                    [
                        { height: 0, opacity: 0, paddingBottom: 0 },
                        { height: p.offsetHeight + "px", opacity: 1 },
                    ],
                    { duration: 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
                )
            }),
        )
    }
    const markLinks = () =>
        document.querySelectorAll('a[href^="http"]:not([target])').forEach((l) => {
            l.target = "_blank"
            l.rel = "noopener"
        })
    markLinks()
    bindPills()
    new MutationObserver(() => {
        markLinks()
        bindPills()
    }).observe(nf, { childList: true, subtree: true })
    const tog = $("tog")
    function applyMotion() {
        const home = $("v-home").classList.contains("on"),
            rb = $("rest").getBoundingClientRect().top,
            anc =
                home && $("rest").offsetHeight && rb <= 0
                    ? (() => {
                          const c =
                              [...$("rest").children].find(
                                  (e) => e.offsetHeight && e.getBoundingClientRect().bottom > 0,
                              ) || $("rest").firstElementChild
                          return { c, d: -c.getBoundingClientRect().top }
                      })()
                    : null
        tog.setAttribute("aria-checked", String(motion))
        nf.classList.toggle("still", !motion)
        nf.classList.add("bgon")
        if (!B && window.WebGL2RenderingContext)
            try {
                initBG()
            } catch {}
        bgDirty = true
        if (!motion) {
            autoT = null
            p = tp
            if (G) G.mx = G.my = null
            if (B) B.mx = B.my = null
            rp = [0, 0, 9]
        }
        root.classList.toggle("snap", motion && snapState[0] && snapState[1])
        if (motion && ready) {
            if (!G && document.fonts) initGL()
            size()
        }
        if (motion && !running) {
            running = true
            last = performance.now()
            requestAnimationFrame(frame)
        }
        if (home && ready) {
            if (anc) {
                const e = anc.c.offsetHeight ? anc.c : anc.c.nextElementSibling
                window.scrollTo(0, e.getBoundingClientRect().top + scrollY + (e === anc.c ? anc.d : 0))
            } else window.scrollTo(0, 0)
            snapSync()
            lastY = scrollY
            document.querySelector(".top").classList.remove("hide")
        }
    }
    let ready = false
    tog.addEventListener("click", () => {
        ready = true
        motion = !motion
        store.set(motion ? "on" : "off")
        applyMotion()
    })
    /* ---------- main loop ---------- */
    function noGL() {
        motion = false
        $("tog").style.display = "none"
        applyMotion()
    }
    if (!window.WebGL2RenderingContext) noGL()
    else
        (document.fonts?.ready ?? Promise.resolve())
            .then(() => {
                if (motion && !G) initGL()
                size()
                sizeBG()
            })
            .catch(noGL)
    function scrollP() {
        if (!root.classList.contains("page") || NA) return
        const r = $("pin").getBoundingClientRect(),
            vh = stick.offsetHeight
        if (!vh) return
        idx = Math.max(0, Math.min(3, Math.round(-r.top / vh)))
        tp = STOP[idx]
    }
    addEventListener(
        "scroll",
        () => {
            if ($("v-home").classList.contains("on") && !NA) homeY = scrollY
            snapSync()
            scrollP()
            if (!motion) {
                p = tp
            }
            const y = scrollY,
                top = document.querySelector(".top")
            if (Math.abs(y - lastY) > 6) {
                top.classList.toggle("hide", y > lastY && y > hideFrom() && !fmOpen())
                lastY = y
            }
        },
        { passive: true },
    )
    let running = false,
        snapState = [true, true],
        wlock = 0,
        wlast = 0,
        wprev = 0
    const inHero = () => motion && snapState[0] && snapState[1] && root.classList.contains("page"),
        restY = () => $("rest").getBoundingClientRect().top + scrollY
    function hideFrom() {
        if (!$("v-home").classList.contains("on")) return 70
        if (NA) return Infinity
        return $("rest").getBoundingClientRect().top + scrollY + 1
    }
    let restTop = 0
    const heroCovers = () =>
        !NA && $("v-home").classList.contains("on") && motion && scrollY <= restTop - innerHeight + 2
    function snapSync() {
        restTop = restY()
        root.classList.toggle("snap", motion && snapState[0] && snapState[1] && scrollY < restY() - 1)
    }
    function stepHero(dir) {
        const y = scrollY,
            ry = restY(),
            vh = stick.offsetHeight
        if (y > ry + 2) return false
        if (y >= ry - 2) {
            if (dir > 0) return false
            jump(3)
            return true
        }
        const n = Math.round(y / vh) + dir
        if (n < 0) return true
        if (n > 3) window.scrollTo({ top: ry, behavior: motion ? "smooth" : "auto" })
        else jump(n)
        return true
    }
    addEventListener(
        "wheel",
        (e) => {
            if (fmOpen()) {
                if (e.target.closest?.(".fmp")) return
                fmSet(false)
            }
            if (!inHero() || e.ctrlKey || !e.deltaY) return
            const y = scrollY,
                ry = restY()
            if (y > ry + 2 || (y >= ry - 2 && e.deltaY > 0)) return
            e.preventDefault()
            const now = performance.now(),
                fresh = now - wlast > 160 || Math.abs(e.deltaY) > Math.abs(wprev) * 1.7
            wlast = now
            wprev = e.deltaY
            if (now < wlock || !fresh) return
            wlock = now + (motion ? 780 : 260)
            stepHero(Math.sign(e.deltaY))
        },
        { passive: false },
    )
    addEventListener("keydown", (e) => {
        if (!inHero() || e.target.closest?.("input,textarea,select,[role=application],.fm")) return
        const d = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 }[e.key]
        if (!d || (e.key === " " && e.target.closest?.("button,a"))) return
        if (stepHero(e.shiftKey && e.key === " " ? -1 : d)) e.preventDefault()
    })
    document.querySelector(".top").addEventListener("focusin", (e) => e.currentTarget.classList.remove("hide"))
    new ResizeObserver(() => {
        size()
        sizeBG()
        if (motion && $("v-home").classList.contains("on") && G) drawHero()
        if (motion && desktop()) drawBG()
    }).observe(nf)
    let last = performance.now(),
        slow = 0,
        okf = 0
    function frame(now) {
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        if (!document.hidden && motion) {
            T += dt
            if (autoT !== null) {
                autoT += dt
                tp = Math.min(1, autoT / 24)
                if (autoT > 26) autoT = null
            }
            p += (tp - p) * (1 - Math.pow(0.03, dt))
            pm[0] += (pmT[0] - pm[0]) * 0.06
            pm[1] += (pmT[1] - pm[1]) * 0.06
            if (rp[2] < 8) rp[2] += dt
            if (visible && $("v-home").classList.contains("on")) {
                drawHero()
                if (dt > 0.04) slow++
                else okf++
                if (slow > 40 && G && G.scale > 0.5) {
                    G.scale = Math.max(0.5, G.scale - 0.17)
                    slow = 0
                    size()
                }
                if (okf > 300) {
                    slow = 0
                    okf = 0
                }
            }
            if (desktop() && !heroCovers()) drawBG()
            wStep(dt)
        }
        setAct(NA ? 4 : idx)
        if (B && bgDirty && !(motion && desktop())) {
            drawBG()
            bgDirty = false
        }
        if (motion) requestAnimationFrame(frame)
        else running = false
    }
    applyMotion()
    setAct(0)
    route()
    scrollP()
    if (motion && !running) {
        running = true
        requestAnimationFrame(frame)
    }
})()
