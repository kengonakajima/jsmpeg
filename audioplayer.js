// receiving samples from ws

var g_samples_r=new Float32Array(48000);
var g_samples_l=new Float32Array(48000);

var g_samples_debug=new Float32Array(48000*32);

var g_samples_used=0;
var g_samples_debug_used=0;

function shiftSamples(n) {
    for(var i=n;i<g_samples_used;i++) {
        g_samples_r[i-n]=g_samples_r[i];
        g_samples_l[i-n]=g_samples_l[i];
    }
    g_samples_used-=n;
}

var g_recvbuf=new ArrayBuffer(1024*512);
var g_recvbuf_used=0;

function appendRecvbuf(ab) {
    var u8a = new Uint8Array(ab);
    if(g_recvbuf_used+u8a.byteLength > g_recvbuf.byteLength) {
        console.log("recvbuf full");
        return;
    }
    for(var i=0;i<u8a.byteLength;i++) {
        g_recvbuf[g_recvbuf_used+i]=u8a[i];
    }
    g_recvbuf_used+=u8a.byteLength;
//    console.log("appendRecvbuf:",g_recvbuf_used,ab.byteLength,g_recvbuf,ab);
}
function shiftRecvbuf(n) {
    for(var i=n;i<g_recvbuf_used;i++) {
        g_recvbuf[i-n]=g_recvbuf[i];
    }
    g_recvbuf_used-=n;
}
function parseRecvbuf() {
    if(g_recvbuf_used<6) return;
    var payload_len = g_recvbuf[0] + (g_recvbuf[1]*256) + (g_recvbuf[2]*256*256); // ignore [3]
    var funcid = g_recvbuf[4]+(g_recvbuf[5]*256);
//    console.log("XXX:",payload_len,funcid,g_recvbuf);
    if(g_recvbuf_used<6+payload_len) {
        console.log("parseRecvbuf: need more data");
        return;
    }
    var samplenum = payload_len/2/2;
    console.log("AudioDataReceiver write payload_len:",payload_len, "funcid:",funcid, "n:",samplenum);
    var room = g_samples_r.length - g_samples_used;
    if( samplenum > room ) {
        console.log("audiodatareceiver.write: room not enough");
        g_samples_used=0;
    }
    var cnt0=0;
    
    for(var i=0;i<samplenum;i++) {
        var ind=6+i*4;
        var ru16 = (g_recvbuf[ind] + (g_recvbuf[ind+1]*256));
        var lu16 = (g_recvbuf[ind+2] + (g_recvbuf[ind+3]*256));
        if(ru16==0)cnt0++;
        var ri16= ru16>32767 ?  -(65536-ru16) : ru16;
        var li16= lu16>32767 ?  -(65536-lu16) : lu16;
        var r= ri16/32768;
        var l= li16/32768;
//        if(i<3) console.log("LR:",r,l,"U:",ru16,lu16,"b:",g_recvbuf[ind],g_recvbuf[ind+1]);
        g_samples_r[g_samples_used+i] = r;
        g_samples_l[g_samples_used+i] = l;
        g_samples_debug[g_samples_debug_used+i] = g_samples_r[g_samples_used+i];
    }
    if(cnt0>50) console.log("cnt0:",cnt0,samplenum);
        
    g_samples_used+=samplenum;
    g_samples_debug_used+=samplenum;
    console.log("audiodatareceiver.write: append",samplenum,"total:",g_samples_used, g_samples_debug_used);

    shiftRecvbuf(6+payload_len);
}


class AudioReceiver {
    constructor() {}
    write(ab) {
        appendRecvbuf(ab);
        parseRecvbuf();
    }
};
    
var g_audioreceiver = new AudioReceiver();


function startAudioPlayer(url) {
/*    
    var ws = new WebSocket(url,["hoge"]);
    ws.binaryType="arraybuffer";
    ws.onopen = function() { console.log("ws onopen"); }
    ws.onclose = function() { console.log("ws onclose"); }
    ws.onerror = function() { console.log("ws onerror"); }
    ws.onmessage = function(ev) {
        appendRecvbuf(ev.data);
        parseRecvbuf();
    }
*/
    var ws = new JSMpeg.Source.WebSocket(url,{});
    ws.connect(g_audioreceiver);
    ws.start();
}


// playing samples

window.AudioContext = window.AudioContext || window.webkitAudioContext;  
var g_ctx = new AudioContext();
var g_sn = g_ctx.createScriptProcessor(256,2,2);
console.log("audiodatareceiver:",g_ctx,g_sn);
g_sn.onaudioprocess = function(audioProcessingEvent) {
    var inputBuffer = audioProcessingEvent.inputBuffer;
    var outputBuffer = audioProcessingEvent.outputBuffer;
    var out0 = outputBuffer.getChannelData(0);
    var out1 = outputBuffer.getChannelData(1);
    if(g_samples_used>=inputBuffer.length) {
        for (var i = 0; i < inputBuffer.length; i++) {
            out0[i] = g_samples_r[i];
            out1[i] = g_samples_l[i];
        }
        shiftSamples(inputBuffer.length);
        if(g_samples_used > 2048) {
            console.log("buffering too much?");
            shiftSamples(512);
        }
    } else {
        for (var i = 0; i < inputBuffer.length; i++) {
            out0[i] = Math.random()*0.1;
            out1[i] = Math.random()*0.1;
        }
    }
}

var g_src = g_ctx.createConstantSource();
g_src.connect(g_sn);
g_sn.connect(g_ctx.destination);


document.onclick = function() {
    try {
    g_src.start(0);        
    }catch(e) {
    }

    console.log("clkcd");
}

function debugPressed() {
    console.log(g_samples_debug);
    var b=g_ctx.createBuffer(2,48000*32,48000);
    var r = b.getChannelData(0);
    var l = b.getChannelData(1);
    for (var i = 0; i < g_samples_debug_used && i < 48000*32 ; i++) {    
        r[i] = g_samples_debug[i];
        l[i] = g_samples_debug[i];
    }
    var s=g_ctx.createBufferSource();
    s.buffer=b;
    s.connect(g_ctx.destination);
    s.start();
}