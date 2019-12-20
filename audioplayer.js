// receiving samples from ws

var FUNCID_INIT = 0;
var FUNCID_ECHO = 1;
var FUNCID_PCM_SAMPLES = 2; // 24Kmono i16le
var FUNCID_STREAM_ACTIVE = 3;
var FUNCID_VOICE_INPUT_PCM_SAMPLES = 4; // 48k mono i16le
var FUNCID_KEYUP_EVENT = 20;
var FUNCID_KEYDOWN_EVENT = 21;
var FUNCID_CLICK_EVENT = 22;
var FUNCID_MOUSEMOVE_EVENT = 23;
var FUNCID_MOUSEUP_EVENT = 24;
var FUNCID_MOUSEDOWN_EVENT = 25;
var FUNCID_TOUCHSTART_EVENT = 26;
var FUNCID_TOUCHEND_EVENT = 27;
var FUNCID_TOUCHMOVE_EVENT = 28;

var g_mpegplayer;

var g_samples_r=new Float32Array(48000);
var g_samples_l=new Float32Array(48000);
var g_samples_used=0;

var g_clientId=0; // 0 for not init

var g_voicechat_enabled = false; // false to mute

function shiftSamples(n) {
    for(var i=n;i<g_samples_used;i++) {
        g_samples_r[i-n]=g_samples_r[i];
        g_samples_l[i-n]=g_samples_l[i];
    }
    g_samples_used-=n;
}

var g_recvbuf=new ArrayBuffer(1024*512);
var g_recvbuf_used=0;

var g_last_stream_active_at = 0;

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

    for(var i=0;i<10;i++) parseRecvbuf();

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
        var max=0;
        for(var i=0;i<input_samplenum;i++) {
            var ind=6+i*2;
            var u16 = get_u16(g_recvbuf,ind);
            var i16= u16>32767 ? -(65536-u16) : u16;
            var mono= i16/32768;
            g_samples_r[g_samples_used+i*2] = mono;
            g_samples_l[g_samples_used+i*2] = mono;
            g_samples_r[g_samples_used+i*2+1] = mono;
            g_samples_l[g_samples_used+i*2+1] = mono;
            if(mono>max)max=mono;
        }
        g_samples_used+=output_samplenum;
    } else if(funcid==FUNCID_ECHO) {
        var cli_id = get_u32(g_recvbuf,6);
        if(cli_id == g_clientId) {
            var sender_time = get_u32(g_recvbuf,6+4);
            var nowms=parseInt(performance.now());
            var dtms=nowms-sender_time;
            g_lastPing=dtms;
            var span=document.getElementById("ping");
            span.innerHTML= "ping:"+dtms+"ms";
            if(dtms<50) span.style.color="#0f0";
            else if(dtms<150) span.style.color="#ff0";
            else span.style.color="#f00";
        }
    } else if(funcid==FUNCID_INIT) {
        g_clientId=get_u32(g_recvbuf,6);
        console.log("funcid_init: g_clientId:",g_clientId);
    }
    
    shiftRecvbuf(6+payload_len);
}

function createStatusCheckWS(url) {
    var ws = new JSMpeg.Source.WebSocket(url,{});
    ws.last_stream_active_at=0;
    ws.connect( {write: function(ab) {
        var u8a=new Uint8Array(ab);
        var payload_len = get_u32(u8a,0);
        var funcid = get_u16(u8a,4);
        if(funcid==FUNCID_STREAM_ACTIVE) {
            ws.last_stream_active_at = Date.now();
        }
    }});
    ws.getElapsedTimeAfterLastVideo = function() {
        return Date.now() - ws.last_stream_active_at;
    }
    
    ws.start();
    return ws;
}

class AudioReceiver {
    constructor() {}
    write(ab) {
        g_total_audio_recv += ab.byteLength;
        appendRecvbuf(ab);        
    }
};
var g_audioreceiver = new AudioReceiver();
var g_audio_ws;
function startAudioPlayer(url) {
    g_audio_ws = new JSMpeg.Source.WebSocket(url,{});
    g_audio_ws.connect(g_audioreceiver);
    g_audio_ws.start();
}
function sendRPCInt(funcid,iargs) {
    var payload_len = 4*iargs.length;
    var ab=new ArrayBuffer(4+2+payload_len);
    var dv=new DataView(ab);
    dv.setInt32(0,payload_len,true);
    dv.setInt16(4,funcid,true);
    for(var i=0;i<iargs.length;i++) dv.setInt32(6+i*4,iargs[i],true);
//    console.log("sendRPCInt:", ab,g_audio_ws);
    if(g_audio_ws && g_audio_ws.established) g_audio_ws.socket.send(ab);
}
function sendRPCVoice(buf) {
    var f32a = new Float32Array(buf);
    var max=0;
    for(var i=0;i<f32a.length;i++) {
        if(f32a[i]>max)max=f32a[i];
    }
    var i16a = new Int16Array(f32a.length);
    for(var i=0;i<f32a.length;i++) {
        i16a[i]=f32a[i]*32767;
    }
    var payload_len=i16a.length*2;
    var ab=new ArrayBuffer(4+2+payload_len);
    var dv=new DataView(ab);
    dv.setInt32(0,payload_len,true);
    dv.setInt16(4,FUNCID_VOICE_INPUT_PCM_SAMPLES,true);
    for(var i=0;i<i16a.length;i++) {
        dv.setInt16(6+i*2,i16a[i],true);
    }
    if(g_audio_ws && g_audio_ws.established) g_audio_ws.socket.send(ab);
}

// playing samples

window.AudioContext = window.AudioContext || window.webkitAudioContext;  
var g_ctx = new AudioContext();
console.log("AUDIOCONTEXT:",g_ctx);
var g_sn = g_ctx.createScriptProcessor(1024,2,2);
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
            shiftSamples(1024);
        }
    } else {
        for (var i = 0; i < inputBuffer.length; i++) {
            out0[i] = 0;//Math.random()*0.01;
            out1[i] = 0;//Math.random()*0.01;
        }
    }
}

//var g_src = g_ctx.createConstantSource(); // no in mobile safari
var silencebuf = g_ctx.createBuffer(2,2000,48000);
for(var i=0;i<2000;i++) {
    silencebuf.getChannelData(0)[i]=0;
    silencebuf.getChannelData(1)[i]=0;    
}
var g_src = g_ctx.createBufferSource();
g_src.buffer = silencebuf;

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

var g_lastPing=0;
var g_total_audio_recv=0;




function notifyEventAudioPlayer(e) {
    if(e.type=="click") {
        sendRPCInt(FUNCID_CLICK_EVENT, [g_clientId,e.offsetX, e.offsetY] );
    } else if(e.type=="keydown") {
        var k=keyToGLFWIntKey(e.key,e.code);
        sendRPCInt(FUNCID_KEYDOWN_EVENT, [g_clientId,k,e.repeat?1:0]);
    } else if(e.type=="keyup") {
        var k=keyToGLFWIntKey(e.key,e.code);        
        sendRPCInt(FUNCID_KEYUP_EVENT, [g_clientId,k]);        
    } else if(e.type=="mousemove") {
        sendRPCInt(FUNCID_MOUSEMOVE_EVENT,[g_clientId,e.offsetX,e.offsetY])
    } else if(e.type=="mouseup") {
        sendRPCInt(FUNCID_MOUSEUP_EVENT,[g_clientId,e.offsetX,e.offsetY])        
    } else if(e.type=="mousedown") {
        sendRPCInt(FUNCID_MOUSEDOWN_EVENT,[g_clientId,e.offsetX,e.offsetY])
    } else if(e.type=="touchstart") {
        sendRPCInt(FUNCID_TOUCHSTART_EVENT, [g_clientId,e.layerX, e.layerY] );
    } else if(e.type=="touchend") {
        sendRPCInt(FUNCID_TOUCHEND_EVENT, [g_clientId,e.layerX, e.layerY] );
    } else if(e.type=="touchmove") {
        console.log("move:",e);
        sendRPCInt(FUNCID_TOUCHMOVE_EVENT, [g_clientId,e.layerX, e.layerY] );       
    } else {
        console.log("other",e);        
    }
}
function btnUp(keyname) {
    var k=keyToGLFWIntKey(keyname);
    sendRPCInt(FUNCID_KEYUP_EVENT,[g_clientId,k])
}
function btnDown(keyname) {
    var k=keyToGLFWIntKey(keyname);
    sendRPCInt(FUNCID_KEYDOWN_EVENT,[g_clientId,k,0])    
}

setInterval(function() {
    sendRPCInt(FUNCID_ECHO,[g_clientId,parseInt(performance.now())]);
}, 1000);


///////////////

var g_setup_voicechat_done=false;
function setupVoiceChat() {
    if(g_setup_voicechat_done)return;
    
    g_setup_voicechat_done = true;
    AUDIO_BUFFER_SIZE = 1024;
    var callback= function(stream) {
        var source=g_ctx.createMediaStreamSource(stream);
        var processor=g_ctx.createScriptProcessor(AUDIO_BUFFER_SIZE,1,1);
        console.log("setup voice callback!", source, processor, );
        function doproc(ev) {
            var ib=ev.inputBuffer;
            var ob=ev.outputBuffer;
            var indata=ib.getChannelData(0);
            var outdata=ob.getChannelData(0);
            outdata.set(indata);
            var samples=new Float32Array(outdata.buffer);
            var max=0;
            for(var i=0;i<samples.length;i++) {
                if(samples[i]>max)max=samples[i];
            }
            if(g_voicechat_enabled && max > 0.01) {
                //                            console.log("outdata:",to_i(samples[0]*1000));
                if(g_ctx.sampleRate==48000) {
                    sendRPCVoice(outdata.buffer);                  
                } else {
                    console.log("need to resample!");
                }
  
            }
            updateAudioLevelIcon(max);
        }

        var filter=g_ctx.createBiquadFilter();
        filter.type="bandpass";
        filter.frequency.value = (100 + 500) / 2; //いい(ひろい)ほう
        filter.Q.value = 0.3;

        // 音質には期待しないのでモノラルで飛ばす
        var processor = g_ctx.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
        processor.onaudioprocess = doproc;
        
        // 自分のフィードバックいらない
        var gain = g_ctx.createGain();
        gain.gain.value = 0;

        source.connect(filter);
        filter.connect(processor);
        processor.connect(gain);
        gain.connect(g_ctx.destination);

    }

    if(navigator.getUserMedia) {
        navigator.getUserMedia(
            {audio: true, echoCancellation:true, googEchoCancellation:true },
            callback,
            function(err) {
                console.error(err);
            }
        );
    } else if(navigator.mediaDevices.getUserMedia ){
        navigator.mediaDevices.getUserMedia( {audio: true}).then(callback);
    }
}


function showWaitText(tgtcanvas,overlay,chnum,waitcnt,longmessage) {
    var rect = tgtcanvas.getBoundingClientRect();
    overlay.style.left = ""+(rect.x+rect.width/8)+"px";
    overlay.style.top = ""+(rect.y+rect.height/2)+"px";
    var dots = ".";
    for(var i=0;i<(waitcnt%4);i++) dots+=".";
    var ch = "["+chnum+"ch]";
    if(longmessage) {
        overlay.innerHTML = is_ja ? ch+"次のサーバーを待機しています"+dots : ch+"Waiting for the next server"+dots;        
    } else {
        overlay.innerHTML = is_ja ? ch+"待機中"+dots : ch+"Waiting"+dots;                
    }

}


function onClickMicIcon(){
    if(!g_setup_voicechat_done) setupVoiceChat();
    
    g_voicechat_enabled = !g_voicechat_enabled;
    
    var mic = document.getElementById("mic");
    if(g_voicechat_enabled) {
        mic.src="images/active0.png";
    } else {
        mic.src="images/mute.png";
    }
}
function updateAudioLevelIcon(level) {
    if(g_voicechat_enabled) {
        var ind;
        if(level>0.4){
            ind=2;
        } else if( level>0.1) {
            ind=1;
        } else {
            ind=0;
        }
        var mic = document.getElementById("mic");
        mic.src="images/active"+ind+".png";
    }
}