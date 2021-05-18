#! /usr/bin/env node

/*
	Created by Mark Skinner 2020-2021 
	markhskinner@gmail.com
*/

const SETTINGS_PATH = __dirname + '/settings.json';
const HARDCODED_SETTINGS_PATH = __dirname + '/hardcoded_settings.json';
const RESET_SOCKET_AFTER_MS = 900; //if the ping gets above this, the socket and cameras will reset
var HTTPS_PORT = 3000,
	HTTP_PORT = 3030;

//this allows more reliable camera connection, but extends boot time by 5 seconds. It also requires the sudoers rule below
//use 'sudo visudo' and add this line to the bottom: ubuntu ALL=(root) NOPASSWD: /home/ubuntu/catkin_ws/src/roboquest_ui/src/resetUsbCams.sh
var RESET_USB_PORTS_ON_BOOT = false;


var express = require('express');
const https = require('https');
const http = require('http');
const rosnodejs = require('rosnodejs');
const cv = require('opencv4nodejs');
const cp = require('child_process');
var kill = require('tree-kill');
const fs = require('fs');

//enable audio output from server
const Speaker = require('speaker');
const speaker = new Speaker({
	channels:1,
	bitDepth:16,
	sampleRate:22050,
	samplesPerFrame:1024,
});


//start audio stream from robot to client
let Mic = require('node-microphone');
let mic = new Mic();
let micStream;

var cameraExists = false;
var settingsObject,hardcoded;
var rosready = false;
var nh, rospublishers={}, rossubscribers={};
var socketsOpen = 0;
var camJSON={"presets": [{"width":"320","height":"240","quality":100,"name":"low res"}],"camsettings":[{"preset":0,"name":"pi cam"}]};
var camindex = 0;
let cmds = {};
var cps = [];
var mainQuality = 90;
var mainRotation = 0;
var mainBrightness = 0; // -255 255
var mainContrast = 0; // -127 127
var hardcodedLoaded = false;
var resolutionStack = {};
var shutdownFlag = false;
var ismuted = true;//is the robot's mic muted
var speakerInUse = false;

//hosting server

var app = express();
var server = https.createServer({
	key:fs.readFileSync(__dirname + '/server.key'),
	cert:fs.readFileSync(__dirname + '/server.crt'),
	passphrase:'robotserver'
},app).listen(HTTPS_PORT);
app.use(express.static(__dirname + '/public'));
console.log("server running on port "+ HTTPS_PORT);

http.createServer((req,res)=>{
	res.writeHead(301, {"location": "https://" + req.headers['host'] + req.url });
	res.end();
}).listen(HTTP_PORT);


if(RESET_USB_PORTS_ON_BOOT){
	console.log('RESETTING USB DEVICES (takes 5s)...');
	if(cp.execSync(`sudo -l`,{shell:true}).toString().includes('resetUsbCams')){
		cp.execSync(`sudo ${__dirname}/resetUsbCams.sh || true`,{shell:true});
	}else{
		console.log("Can't reset usb devices because of permissions. use visudo and add this line to the bottom if it's not there \n ubuntu ALL=(root) NOPASSWD: /home/ubuntu/catkin_ws/src/roboquest_ui/src/resetUsbCams.sh");
	}
}

console.log('FINDING ALL VIDEO PATHS...');
let validDevices=[];
let output = cp.execSync('v4l2-ctl --list-devices || true',{shell:true});
output = output.toString().split(/\r?\n/);
let nextIsName = true, namedDevices = {}, lastName = '';
for(let i = 0; i < output.length; i++){
	let r = output[i];
	if(r == ''){
		nextIsName = true;
	}
	else if(nextIsName){
		namedDevices[r] = [];
		lastName = r;
		nextIsName = false;
	}
	else{
		namedDevices[lastName].push(r.replace('\t',''));
	}
}
console.log(namedDevices);
console.log('CHECKING VALIDITY OF V4l2 DEVICES...');
let dkeys = Object.keys(namedDevices);
for(let i = 0; i < dkeys.length; i++){
	let devices = namedDevices[dkeys[i]];
	if(!dkeys[i].includes('bcm2835-codec')){	//make sure camera is real
		for(let d = 0; d < devices.length; d++){
			let output = cp.execSync('v4l2-ctl -d '+devices[d]+' --get-fmt-video || true',{shell:true}).toString().split(/\r?\n/);
			if(!output[0].includes('Invalid Argument')){ //make sure v4l pixel format is valid
				validDevices.push(devices[d]);
				break;
			}
		}
	}
}
console.log('(CONNECTING TO OPENCV) VALID DEVICES',validDevices);
let camArray = [], index = 0;
for(let i = 0; i < validDevices.length; i++){
	camArray[index] = new cv.VideoCapture(validDevices[i]);
	camArray[index].set(cv.CAP_PROP_FRAME_WIDTH,640);
	camArray[index].set(cv.CAP_PROP_FRAME_HEIGHT,480);
	camArray[index].set(cv.CAP_PROP_FPS,25);
	index++;
	console.log('camera found at index '+i);
	cps[index]=0;
	cameraExists = true;
}
console.log('total of ' + camArray.length + ' cameras found');

function requestResolutionSet(c,w,h,f){
	resolutionStack[c]=[w,h,f];
}

var socket = require('socket.io');
var io = socket(server, {pingInterval: 400, pingTimeout: RESET_SOCKET_AFTER_MS});
io.set('origins','*:*');

function joinRosTopics(){
	fs.readFile(SETTINGS_PATH, (err, data) => {
		if (err) throw err;
		let settingsObject;
		try{
			settingsObject = JSON.parse(data);
		}catch(e){console.log(e);}
		if(settingsObject){
			let widgets = settingsObject['widgets'];
			
			//attatch ROS publishers and listeners
			for(let i = 0; i < widgets.length; i++){
				let topic = widgets[i].topic;
				if(topic != '' && topic != '/' && nh){
					console.log(widgets[i].type + ' connecting to   '+widgets[i].topic);
					
					let latch;
					if(widgets[i].latching) latch = widgets[i].latching;
					else latch = false;
					switch(widgets[i].type){
						case '_button':
						case '_checkbox':
							rospublishers[topic] = nh.advertise(topic, 'std_msgs/Bool',{latching:latch});
						break;
						case '_joystick':
							rospublishers[topic] = nh.advertise(topic, 'geometry_msgs/Vector3');
						break;
						case '_slider':
							rospublishers[topic] = nh.advertise(topic, 'std_msgs/Float64',{latching:latch});
						break;
						case '_inputbox':
							let msgType = widgets[i]['msgType'];
							if(msgType == undefined) msgType = 'std_msgs/String';
							if(rospublishers[topic]) rospublishers[topic].shutdown();
							rospublishers[topic] = nh.advertise(topic, msgType);
						break;
						case '_logger':
						case '_value':
						case '_serial':
							if(widgets[i]['msgType'] == undefined) widgets[i]['msgType'] = 'std_msgs/String';
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, widgets[i]['msgType'], (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg});
							});
						break;
						case '_compass':
							if(widgets[i]['msgType'] == undefined) widgets[i]['msgType'] = 'std_msgs/Int16';
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, widgets[i]['msgType'], (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg});
								console.log(msg);
							});
						break;
						case '_arm':
						case '_horizon':
							if(widgets[i]['msgType'] == undefined) widgets[i]['msgType'] = 'std_msgs/Float64MultiArray';
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, widgets[i]['msgType'], (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg.data});
							});
						break;
						case '_rosImage':
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, 'sensor_msgs/CompressedImage', (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg.data});
							});
						break;
						case '_light':
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, 'std_msgs/Bool', (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg});
							});
						break;
						case '_audio':
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, 'std_msgs/Int16', (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg});
							});
						break;
						case '_gauge':
							if(widgets[i]['msgType'] == undefined) widgets[i]['msgType'] = 'std_msgs/Float64';
							if(rossubscribers[topic]) rossubscribers[topic].shutdown();
							rossubscribers[topic] = nh.subscribe(topic, widgets[i]['msgType'], (msg) => {
								io.emit('telem',{topic:topic,id:i,msg:msg});
							});
						break;
					}
				}
				let topic2 = widgets[i].topic2;
				if(topic2 && topic2 != '' && topic2 != '/' && nh){
					console.log(widgets[i].type + ' connecting to   '+topic2);
					switch(widgets[i].type){
						case '_serial':
							rospublishers[topic2] = nh.advertise(topic2, 'std_msgs/String');
						break;
					}
				}
			}
			let consoleTextTopic = settingsObject.config.consoleText;
			if(consoleTextTopic != undefined && consoleTextTopic && consoleTextTopic != ''){
				if(rossubscribers.consoleText) rossubscribers.consoleText.shutdown();
				rossubscribers.consoleText = nh.subscribe(consoleTextTopic, 'std_msgs/String', (msg) => {
					io.emit('telem',{topic:'__consoleText',msg:msg});
				});
			}
			let heartbeat = settingsObject.config.heartbeat;
			if(heartbeat != undefined && heartbeat && heartbeat != ''){
				if(rospublishers.heartbeat) rospublishers.heartbeat.shutdown();
				rospublishers.heartbeat = nh.advertise(heartbeat, 'std_msgs/Int16');
			}
			rosready = true;
		}
	});
}
  
rosnodejs.initNode('/webserver').then(() => {
	nh = rosnodejs.nh;
	joinRosTopics();
}).catch((e) => {
	console.log('Error connecting to ROS: ' + e);
});

var lastSocketId = undefined;
io.sockets.on('connection', function(socket){
	socketsOpen++;
	io.emit('instanceCount',socketsOpen);
	io.emit('muted',ismuted);
	io.emit('spk',speakerInUse);
    console.log('made connection');
  
  //get settings from json and send to client
  fs.readFile(SETTINGS_PATH, (err, data) => {
    if (err) throw err;
    settingsObject = JSON.parse(data);
    camJSON = settingsObject.config.cams;
    socket.emit('settings',settingsObject);
    //set initial resolutions for cameras
    if(cameraExists){
		for(let i = 0; i < Math.min(camArray.length,camJSON.camsettings.length); i++){
			requestResolutionSet(i,parseInt(camSettings(camJSON,i).width),parseInt(camSettings(camJSON,i).height),parseInt(camSettings(camJSON,i).fps));
			cps[i] = camJSON.camsettings[i].preset;
			if(camJSON.camsettings[i].rotation == undefined) camJSON.camsettings[i].rotation = 0;
			if(camJSON.camsettings[i].contrast == undefined) camJSON.camsettings[i].contrast = 0;
			if(camJSON.camsettings[i].brightness == undefined) camJSON.camsettings[i].brightness = 0;
		}
		mainQuality = parseInt(camSettings(camJSON,camindex).quality);
		mainRotation = parseInt(camJSON.camsettings[camindex].rotation);
		mainContrast = parseInt(camJSON.camsettings[camindex].contrast);
		mainBrightness = parseInt(camJSON.camsettings[camindex].brightness);
    	console.log('main quality is ' + mainQuality);
    	socket.emit('makeThumbs',camArray.length,camindex,cps);
	}else{
		socket.emit('makeThumbs');
	}
    
    io.emit('cmdStopButtons',Object.keys(cmds));
    console.log('number of widgets: ' + settingsObject.widgets.length);
  });
  //get settings from json and send to client
  fs.readFile(HARDCODED_SETTINGS_PATH, (err, data) => {
    if (err) throw err;
    hardcoded = JSON.parse(data);
    console.log(JSON.stringify(hardcoded));
    socket.emit('hardcoded_settings',hardcoded);
    hardcodedLoaded=true;
  });

  //widgets client to server
  socket.on('WCTS', function(data){
    try{
		if(settingsObject.config.saveWidgets){
			settingsObject['widgets'] = data;
			joinRosTopics();
			fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsObject));
			console.log('recieved updated widget settings from client');
		}
    }
    catch(e){
      console.log(e);
    }
  });
  //config settings client to server
  socket.on('configSettings', function(data){
	if(data){
	    try{
	      settingsObject['config'] = data;
	      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settingsObject));
		  console.log('recieved updated config settings from client');
		  //do stuff with your new settings here (camera resolution, running cmds etc.)
		  if(cameraExists){
			  camJSON = data.cams;
			  for(let i = 0; i < camArray.length; i++){
				requestResolutionSet(i,parseInt(camSettings(camJSON,i).width),parseInt(camSettings(camJSON,i).height),parseInt(camSettings(camJSON,i).fps));
				cps[i] = camJSON.camsettings[i].preset;
			  }
		  }
	    }
	    catch(e){
	      console.log(e);
	    }
	}
  });
  //start a child process
  socket.on('cmd', function(data){
	if(hardcodedLoaded && hardcoded.show_terminal){
		cmds[data] = cp.spawn(data,[],{shell:true});
		cmds[data].stdout.on('data', stdout => {
			socket.emit('cmdOut',stdout.toString());
			console.log(stdout.toString());
		});
		cmds[data].stderr.on('data', stderr => {
			socket.emit('cmdOut',stderr.toString());
			console.log(stderr.toString());
		});
		cmds[data].on('close', code => {
			socket.emit('cmdOut','exit code: '+code+'\n');
			socket.emit('removeCmd',data);
			console.log(code);
			if(cmds[data]) delete cmds[data];
		});
	}else{
		console.log('terminal has been disabled');
	}
  });
  socket.on('stopcmd', function(data){
	  if(hardcodedLoaded && hardcoded.show_terminal && cmds[data]){
		console.log('stopping '+data);
		kill(cmds[data].pid);
		delete cmds[data];
	  }
	});
  socket.on('exit', function(data){
	  console.log('closing server...');
	  if(cameraExists) shutdownFlag = true;
	  else process.exit(1);
	});
    //send a 
  socket.on('hb',ping => {
	  if(!lastSocketId) lastSocketId = socket.id;
	  if(rospublishers.heartbeat && socket.id == lastSocketId) rospublishers.heartbeat.publish({data:ping});
  });
  //ROS client to server
  socket.on('ROSCTS', function(data){
	    var topic = data.topic;
	    switch(data.type){
			case '_button':
			case '_checkbox':
				if(rospublishers[topic]) rospublishers[topic].publish({ data:data.pressed});
			break;
			case '_inputbox':
			case '_slider':
				if(rospublishers[topic]) rospublishers[topic].publish({ data:data.value});
			break;
			case '_joystick':
				if(rospublishers[topic]) rospublishers[topic].publish({x:data.x,y:data.y,z:0});
			break;
			case '_serial':
				if(rospublishers[topic]) rospublishers[topic].publish({data:data.value});
			break;
		}
	    console.log('Publish Ros ' + JSON.stringify(data));
  });
  //remove all subscribers/publishers from topic
  socket.on('shutROS', function(data){
	  if(rossubscribers[data]) rossubscribers[data].shutdown();
	  if(rospublishers[data]) rospublishers[data].shutdown();
  });
  //change resolution of camera. c is camera, v is preset value (index)
  socket.on('setPreset', function(data){
	if(cameraExists){
		console.log(data.c,data.v);
		console.log(camJSON.presets[data.v].name);
		if(camArray[data.c]){
			requestResolutionSet(data.c,parseInt(camJSON.presets[data.v].width),parseInt(camJSON.presets[data.v].height),parseInt(camJSON.presets[data.v].fps));
			cps[data.c] = data.v;
			if(data.c == camindex){
				mainQuality = parseInt(camJSON.presets[data.v].quality);
				mainRotation = parseInt(camJSON.camsettings[data.c].rotation);
				mainContrast = parseInt(camJSON.camsettings[data.c].contrast);
				mainBrightness = parseInt(camJSON.camsettings[data.c].brightness);
			}
		}
	}
  });
  socket.on('setCam', function(data){
	if(cameraExists){
		camindex = data;
		if(camJSON.presets[cps[data]] !== undefined){
			mainQuality = parseInt(camJSON.presets[cps[data]].quality);
			mainRotation = parseInt(camJSON.camsettings[data].rotation);
			mainContrast = parseInt(camJSON.camsettings[data].contrast);
			mainBrightness = parseInt(camJSON.camsettings[data].brightness);
		}
		else{
			mainQuality = 20;
			mainRotation = 0;
			mainContrast = 0;
			mainBrightness = 0;
		}
		rotation = mainRotation;
		contrast = mainContrast;
		brightness = mainBrightness;
		console.log(`Change Camera to ${data} rotation ${mainRotation} contrast ${mainContrast} brightness ${mainBrightness}`);
	}
  });
  socket.on('closeOtherSockets', function(data){
    socket.broadcast.emit('closeSocket','');
  });
  socket.on('disconnect', function(data){
	socket.disconnect();
    socketsOpen--;
	lastSocketId = undefined;
    io.emit('instanceCount',socketsOpen);
  });
	
  socket.on('unmuteRobot', function(data){
	//start robot audio stream if possible
	  if(ismuted){
		  micStream = mic.startRecording();
		  //stream microphone data as WAVE 16bit 16000 4000 byte chunks to the client
			micStream.on('data', (chunk) => {
			  io.emit('micData',chunk);
			});
		 console.log('unmuted robot mic');
		 socket.emit('robotUnmuted');
		  ismuted = false;
	  }
  });
  socket.on('muteRobot', function(data){
	//start robot audio stream if possible
	  if(!ismuted){
		  mic.stopRecording();
		  micStream = undefined;
		  console.log('muted robot mic');
		  socket.emit('robotMuted');
		  ismuted = true;
	  }
  });
	
	
	//=================================== AUDIO OUTPUT STREAM
  socket.on('audioPacket', function(data){
	speaker.write(Buffer.from(data,'base64'));
  });
});

//==================================== MICROPHONE STREAM

//listen for mic debug messages
mic.on('info', (info) => {
	console.log(info.toString());
});
mic.on('error', (error) => {
  console.log(error.toString());
});
//cams is the entire cam json from config
//cam index is the camera number in the camArray
function camSettings(cams, camindex){
	//{"name":"Low","width":"640","height":"480","quality":"30","fps":"20"}
	return Object.assign({"name":"Low","width":"640","height":"480","quality":"30","fps":"20"},cams.presets[cams.camsettings[camindex].preset]);
}

let oldtime = 0;
let rotation = mainRotation;
let contrast = mainContrast;
let brightness = mainBrightness;
let retrieveCam = function(){
	time = new Date().getTime();
	let c = camindex;
	camArray[c].readAsync().then(function(result){
		if(!result.empty){
			if(rotation != 0) result = result.rotate(rotation-1);
			
			let shadow = 0, highlight = 0, alpha_b = 0, gamma_b = 0,alpha_c = 0, gamma_c = 0, buf;
			if(brightness != 0){
				if(brightness > 0){
					shadow = brightness;
					highlight = 255;
				}
				else{
					shadow = 0;
					highlight = 255 + brightness;
				}
				alpha_b = (highlight - shadow) / 255;
				gamma_b = shadow;
				
				buf = result.addWeighted(alpha_b,result,0,gamma_b);
			}
			else{
				buf = result.copy();
			}
			if(contrast != 0){
				let f = (131 * (contrast + 127)) / (127 * (131 - contrast));
				alpha_c = f;
				gamma_c = 127*(1-f);
				
				buf = buf.addWeighted(alpha_c, buf, 0, gamma_c);
			}
			
			result = buf;
			
			cv.imencodeAsync('.jpg',result,[cv.IMWRITE_JPEG_QUALITY,mainQuality]).then(function(result){
				io.emit('image',result.toString('base64'));
			}).catch((e)=>{console.log(e)});
		}
		
		//update resolutions
		let keys = Object.keys(resolutionStack);
		if(keys.length > 0){
			rotation = mainRotation;
			contrast = mainContrast;
			brightness = mainBrightness;
			for(let i = 0; i < keys.length; i++){
				camArray[keys[i]].set(cv.CAP_PROP_FRAME_WIDTH,resolutionStack[keys[i]][0]);
				camArray[keys[i]].set(cv.CAP_PROP_FRAME_HEIGHT,resolutionStack[keys[i]][1]);
				camArray[keys[i]].set(cv.CAP_PROP_FPS,resolutionStack[keys[i]][2]);
			}
			resolutionStack = {};
		}
		
		if(shutdownFlag){
			closeDownServer();
			process.exit(1);
		}
		setTimeout(retrieveCam,0);
		
	}).catch((e)=>{console.log("can't read camera " + e);});
	io.emit('fps',1000/(time-oldtime));
	oldtime = time;
}
if(cameraExists) setTimeout(retrieveCam,0);

function closeDownServer(){
	for(let i = 0; i < camArray.length; i++){
		camArray[i].release();
		camArray[i].read();
		console.log('released cam',i);
	}
	mic.stopRecording();
}

process.on('SIGINT',()=>{
	closeDownServer();
});

