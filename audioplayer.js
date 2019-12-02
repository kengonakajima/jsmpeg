// receiving samples from ws

var FUNCID_PCM_SAMPLES = 10;
var FUNCID_KEY_EVENT = 20;
var FUNCID_CLICK_EVENT = 21;
var FUNCID_MOUSEMOVE_EVENT = 22;

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

    if(g_recvbuf_used<6+payload_len) {
        console.log("parseRecvbuf: need more data");
        return;
    }
    if(funcid==FUNCID_PCM_SAMPLES) {
        // receiving raw pcm16le monoral data
        var input_samplenum = payload_len/2;
        var output_samplenum = input_samplenum * 2; // 24k to 48k
        var room = g_samples_r.length - g_samples_used;
        if( output_samplenum > room ) {
            console.log("audiodatareceiver.write: room not enough");
            g_samples_used=0;
        }
        for(var i=0;i<input_samplenum;i++) {
            var ind=6+i*2;
            var u16 = (g_recvbuf[ind] + (g_recvbuf[ind+1]*256));
            var i16= u16>32767 ? -(65536-u16) : u16;
            var mono= i16/32768;
            g_samples_r[g_samples_used+i*2] = mono;
            g_samples_l[g_samples_used+i*2] = mono;
            g_samples_r[g_samples_used+i*2+1] = mono;
            g_samples_l[g_samples_used+i*2+1] = mono;            
            g_samples_debug[g_samples_debug_used+i*2] = mono;
            g_samples_debug[g_samples_debug_used+i*2+1] = mono;
        }
        g_samples_used+=output_samplenum;
        g_samples_debug_used+=output_samplenum;
    }
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


var g_ws;
function startAudioPlayer(url) {
    g_ws = new JSMpeg.Source.WebSocket(url,{});
    g_ws.connect(g_audioreceiver);
    g_ws.start();
}
function sendRPCInt(funcid,iargs) {
    var payload_len = 4*iargs.length;
    var ab=new ArrayBuffer(4+2+payload_len);
    var dv=new DataView(ab);
    dv.setInt32(0,payload_len,true);
    dv.setInt16(4,funcid,true);
    for(var i=0;i<iargs.length;i++) dv.setInt32(6+i*4,iargs[i],true);
    console.log("sendRPCInt:", ab,g_ws);
    g_ws.socket.send(ab);
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
            console.log("buffer shift more");
            shiftSamples(512);
        }
    } else {
        for (var i = 0; i < inputBuffer.length; i++) {
            out0[i] = Math.random()*0.01;
            out1[i] = Math.random()*0.01;
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

/////////////

// input events
function notifyEventAudioPlayer(e) {
    if(e.type=="click") {
        console.log("click:", e.offsetX,e.offsetY,e);
        sendRPCInt(FUNCID_CLICK_EVENT, [e.offsetX, e.offsetY] );
    } else if(e.type=="keydown") {
        console.log("kd",e.key);
    } else if(e.type=="keyup") {
        console.log("ku",e.key);
    } else if(e.type=="mousemove") {
        console.log("mousemove",e);
    } else if(e.type=="mouseup") {
        console.log("mouseup",e);
    } else if(e.type=="mousedown") {
        console.log("mousedown",e);                
    } else {
        console.log("other",e);        
    }
}
