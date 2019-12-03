// receiving samples from ws

var FUNCID_ECHO = 1;
var FUNCID_PCM_SAMPLES = 10;
var FUNCID_KEYUP_EVENT = 20;
var FUNCID_KEYDOWN_EVENT = 21;
var FUNCID_CLICK_EVENT = 22;
var FUNCID_MOUSEMOVE_EVENT = 23;
var FUNCID_MOUSEUP_EVENT = 24;
var FUNCID_MOUSEDOWN_EVENT = 25;

var g_mpegplayer;

var g_samples_r=new Float32Array(48000);
var g_samples_l=new Float32Array(48000);
var g_samples_used=0;


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
function get_u32(ab,ofs) {
    return ab[ofs]+(ab[ofs+1]*256)+(ab[ofs+2]*65536)+(ab[ofs+3]*65536*256);
}
function get_u16(ab,ofs) {
    return ab[ofs]+(ab[ofs+1]*256);
}
function parseRecvbuf() {
    if(g_recvbuf_used<6) return;
    var payload_len = get_u32(g_recvbuf,0);
    var funcid = get_u16(g_recvbuf,4);

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
            var u16 = get_u16(g_recvbuf,ind);
            var i16= u16>32767 ? -(65536-u16) : u16;
            var mono= i16/32768;
            g_samples_r[g_samples_used+i*2] = mono;
            g_samples_l[g_samples_used+i*2] = mono;
            g_samples_r[g_samples_used+i*2+1] = mono;
            g_samples_l[g_samples_used+i*2+1] = mono;            
        }
        g_samples_used+=output_samplenum;
    } else if(funcid==FUNCID_ECHO) {
        var sender_time = get_u32(g_recvbuf,6);
        var nowms=parseInt(performance.now());
        var dtms=nowms-sender_time;
        g_lastPing=dtms;
        updateStatus();
    }
    
    shiftRecvbuf(6+payload_len);
}


class AudioReceiver {
    constructor() {}
    write(ab) {
        g_total_audio_recv += ab.byteLength;
        appendRecvbuf(ab);        
        for(var i=0;i<10;i++) parseRecvbuf();
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
//    console.log("sendRPCInt:", ab,g_ws);
    if(g_ws.established) g_ws.socket.send(ab);
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

/////////////

function keyToGLFWIntKey(key,code) {
    if(key.length==1) return key.toUpperCase().charCodeAt(0);
    switch(key) {
    case "Shift":
        if(code=="ShiftLeft") return 340; //  GLFW_KEY_LEFT_SHIFT
        if(code=="ShiftRight") return 344;  //  GLFW_KEY_RIGHT_SHIFT
        break;
    case "Control":
        if(code=="ControlLeft") return 341; //  GLFW_KEY_LEFT_CONTROL
        if(code=="ControlRight") return 345;  //  GLFW_KEY_RIGHT_CONTROL
        break;
    case "Alt":
        if(code=="AltLeft") return 342; //  GLFW_KEY_LEFT_ALT
        if(code=="AltRight") return 346;  //  GLFW_KEY_RIGHT_ALT
        break;
    case "ArrowUp": return 265; // GLFW_KEY_UP
    case "ArrowDown": return 264; // GLFW_KEY_DOWN
    case "ArrowRight": return 262; // GLFW_KEY_RIGHT
    case "ArrowLeft": return 263; // GLFW_KEY_LEFT
    case "Enter": return 257; // GLFW_KEY_ENTER
    case "Tab": return 258; // GLFW_KEY_TAB
    case "Backspace": return 259; // GLFW_KEY_BACKSPACE
    case "Escape": return 256; // GLFW_KEY_ESCAPE
    case "F1": return 290; // GLFW_KEY_F1
    case "F2": return 291; // GLFW_KEY_F2
    case "F3": return 292; // GLFW_KEY_F3
    case "F4": return 293; // GLFW_KEY_F4
    case "F5": return 294; // GLFW_KEY_F5
    case "F6": return 295; // GLFW_KEY_F6
    case "F7": return 296; // GLFW_KEY_F7
    case "F8": return 297; // GLFW_KEY_F8
    case "F9": return 298; // GLFW_KEY_F9
    case "F10": return 299; // GLFW_KEY_F10
    case "F11": return 300; // GLFW_KEY_F11
    case "F12": return 301; // GLFW_KEY_F12       
    default:
        console.log("invalid key input:",key,code);
        return 0;
    }
}
// input events

var g_ofsX=0, g_ofsY=0;
var g_mouseButtonDown=false;
var g_lastClickAt=0;
var g_clickCount=0;
var g_lastPing=0;
var g_total_audio_recv=0;
var g_network_stats="";

function updateStatus() {
    var e=document.getElementById("status");
    e.innerHTML = "mouseDown:"+g_mouseButtonDown + " ofsX:"+g_ofsX + " ofsY:"+g_ofsY + "<BR>" +
        "click:" + g_clickCount + " clickat:" + g_lastClickAt + " ping:" + g_lastPing + "ms<BR>" +
        g_network_stats;

}
setInterval(function() {
    if(g_mpegplayer) {
        
        g_network_stats = "audioRecvB:" + g_total_audio_recv + " videoRecvB:" + g_mpegplayer.source.totalBytesReceived;
        g_mpegplayer.source.totalBytesReceived=0;
        g_total_audio_recv=0;
    }                     
},1000);


function notifyEventAudioPlayer(e) {
    if(e.type=="click") {
        g_clickCount++;
        g_lastClickAt=parseInt(performance.now());
        updateStatus();
        sendRPCInt(FUNCID_CLICK_EVENT, [e.offsetX, e.offsetY] );
    } else if(e.type=="keydown") {
        var k=keyToGLFWIntKey(e.key,e.code);
        sendRPCInt(FUNCID_KEYDOWN_EVENT, [k,e.repeat?1:0]);
    } else if(e.type=="keyup") {
        var k=keyToGLFWIntKey(e.key,e.code);        
        sendRPCInt(FUNCID_KEYUP_EVENT, [k]);        
    } else if(e.type=="mousemove") {
        sendRPCInt(FUNCID_MOUSEMOVE_EVENT,[e.offsetX,e.offsetY])
        g_ofsX=e.offsetX;
        g_ofsY=e.offsetY;
        updateStatus();
    } else if(e.type=="mouseup") {
        g_mouseButtonDown=false;
        updateStatus();        
        sendRPCInt(FUNCID_MOUSEUP_EVENT,[e.offsetX,e.offsetY])        
    } else if(e.type=="mousedown") {
        g_mouseButtonDown=true;
        updateStatus();        
        sendRPCInt(FUNCID_MOUSEDOWN_EVENT,[e.offsetX,e.offsetY])                
    } else {
        console.log("other",e);        
    }
}
function btnUp(keyname) {
    var k=keyToGLFWIntKey(keyname);
    sendRPCInt(FUNCID_KEYUP_EVENT,[k])
}
function btnDown(keyname) {
    var k=keyToGLFWIntKey(keyname);
    sendRPCInt(FUNCID_KEYDOWN_EVENT,[k,0])    
}

setInterval(function() {
    sendRPCInt(FUNCID_ECHO,[parseInt(performance.now())]);
}, 1000);