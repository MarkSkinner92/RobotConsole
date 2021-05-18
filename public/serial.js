async function connectToSerial(serialWidget){
	if('serial' in navigator){
		if(serialWidget.serialObject == undefined){
			serialWidget.serialObject = new SerialObject(serialWidget);
		}
		if(serialWidget.serialObject.connected){
		   serialWidget.serialObject.end();
		}else{
			serialWidget.serialObject.start();
		}
	}else{
		serialWidget.querySelector('#status').innerHTML = 'You must enable experimental web platform features in chrome://flags';
	}
}
class SerialObject {
	constructor(serialWidget){
		this.serialWidget = serialWidget;
		this.connected = false;
	}
	async start(){
		this.WA = widgetArray[indexMap[this.serialWidget.id]];
		this.rosLE = this.WA.rosLE;
		this.usbLE = this.WA.usbLE;
		this.status = this.serialWidget.querySelector('#status');
		this.button = this.serialWidget.querySelector('#button_ap');
		this.txLight = this.serialWidget.querySelector('#TX_ap');
		this.rxLight = this.serialWidget.querySelector('#RX_ap');

		this.port = await navigator.serial.requestPort();
		try{
			await this.port.open({baudRate: parseInt(this.WA.baud) || 9600});
		}catch(e){
			console.log(e);
			this.status.style.backgroundColor = '#F00';
			if(e.code == 11){
				this.status.innerText = "Port already open";
			}
			else{
				this.status.innerText = "Can't open port";
			}
			return;
		}
		this.writer = this.port.writable.getWriter();
		this.reader = this.port.readable.getReader();
		if(this.writer && this.reader){
			this.status.style.backgroundColor = '#75FF75';
			this.status.innerText = 'Connected';
			this.button.innerText = 'Disconnect';
			this.connected = true;
		}
		await sleep(1500); //wait for device to boot
		//read serial data from 
		this.buffer = [];
		try{
			while(true){
				const { value, done } = await this.reader.read();
				if(done){
					console.log('reader is done');
					break;
				}
				for(let i = 0; i < value.length; i++){
					if(this.splitLine(this.usbLE,value[i])){
						if(this.buffer.length != 0){
							let str = new TextDecoder().decode(Uint8Array.from(this.buffer));
							console.log(this.buffer);
							sendToRos(this.WA['topic2'],{value:str},'_serial');
							this.flashRX();
							this.buffer = [];
						}
					}
					else this.buffer.push(value[i]);
				}
			}
		}
		catch(e){
			console.log(e);
		}
	}
	splitLine(code,val){
		switch(code){
			case 'Newline (10)':
				return val == 10;
			break;
			case 'Carrage Return (13)':
				return val == 13;
			break;
			case 'NL and/or CR (10 & 13)':
				return val == 10 || val == 13;
			break;
			default:
				return true;
			break;
		}
	}
	end(){
		console.log('disconnecting serial port');
		if(this.writer){
			this.writer.releaseLock();
			this.writer = undefined;
		}
		if(this.reader){
			this.reader.cancel();
			this.reader.releaseLock();
			this.reader = undefined;
		}
		this.button.setAttribute('data-mode','discon');
		this.status.innerText = "Disconnected";
		this.status.style.backgroundColor = '#FF0';
		this.button.innerText = 'Connect';
		this.port.close();
		this.connected = false;
		return;
	}
	write(data){
		let d = new Uint8Array([data]);
		if(this.writer){
			this.flashTX();
			this.writer.write(d);
		}else{
			console.log('the port you are trying to write to is not connected');
		}
	}
	writeString(data){
		let l = data.length;
		for(let i = 0; i < l; i++){
			this.write(data.charCodeAt(i));
		}
		this.writeLE();
	}
	writeLE(){
		switch(this.rosLE){
			case 'Newline (10)':
				this.write(10);
			break;
			case 'Carrage Return (13)':
				this.write(13);
			break;
			case 'NL and CR (10 & 13)':
				this.write(10);
				this.write(13);
			break;
			default:
				return;
			break;
		}
	}
	flashTX(){
		this.txLight.style.backgroundColor = '#FF0';
		setTimeout(()=>{this.txLight.style.backgroundColor = '#FFF'},100);
	}
	flashRX(){
		this.rxLight.style.backgroundColor = '#FF0';
		setTimeout(()=>{this.rxLight.style.backgroundColor = '#FFF'},100);
	}
}
function sleep(ms){
	return new Promise(resolve => setTimeout(resolve,ms));
}
var ev;
navigator.serial.addEventListener("disconnect", (event) => {
	console.log('serial disconnected');
	for(let i = 0; i < widgetArray.length; i++){
		if(widgetArray[i].type == '_serial'){
			let obj = document.getElementById(widgetArray[i].id).serialObject;
			if(obj && obj.port.getInfo().usbVendorId == event.port.getInfo().usbVendorId && obj.port.getInfo().usbProductId == event.port.getInfo().usbProductId) obj.end();
		}
	}
	ev = event;
});