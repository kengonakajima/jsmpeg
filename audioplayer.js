//

class AudioDataReceiver {
    constructor() {
        console.log("AudioDataReceiver cons");
    }
    write(data) {
        var dv = new DataView(data);
        var payload_len = dv.getUint32(0,true);
        var funcid = dv.getUint16(4,true);
        console.log("AudioDataReceiver write payload_len:",payload_len, "funcid:",funcid);
    }
};
function startAudioPlayer(url) {
    var ws = new JSMpeg.Source.WebSocket(url,{}) ;
    console.log("startAudioPlayer: ws:",ws);
    ws.start(); // connect to server
    var audioDestination = new AudioDataReceiver();
    ws.connect(audioDestination);
}