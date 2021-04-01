socket = io(window.location.hostname + ':' + window.location.port);
var mask = document.getElementById('mask');
let settings = {};
let camcount = 1;
let gotSettings = false, gotThumbs = false;
socket.on('settings', (data) => {
	if(!gotSettings){
		settings = data;
		gotSettings = true;
		//addPresets(settings.config.cams.presets.length);
		//addMacros(settings.config.macros.length);
	}
	hideMessage();
});
socket.on('hardcoded_settings',function(data){
	if(!data.show_config_settings) document.body.innerHTML = '';
});

//recieve camera count
socket.on('makeThumbs',(data) => {
	if(!gotThumbs){
		if(data){
			camcount = data;
			document.getElementById('camcount').innerText = 'Cameras ('+camcount+' detected)';
			gotThumbs = true;
			addCams(data);
		}
		else{
			camcount = 0;
		}
		populateConfig(settings['config']);
	}
	document.getElementById('header').innerText = 'Robot Settings';
});

function populateConfig(data){
	if(!data['cams']) data['cams'] = {};
	addPresets(data.cams.presets.length);
	addMacros(data.macros.length);
	refreshSelectPresets();
	for(let i = 0; i < document.getElementsByClassName('cams_name').length; i++){//for each camera
		if(!data.cams.camsettings[i]) data.cams.camsettings[i] = {preset:0,name:"cam "+i};
		document.getElementsByClassName('cams_preset')[i].value = data.cams.camsettings[i]['preset'];
		document.getElementsByClassName('cams_name')[i].value = data.cams.camsettings[i]['name'];
		document.getElementsByClassName('cams_rotation')[i].value = data.cams.camsettings[i]['rotation'] || 0;
		document.getElementsByClassName('cams_contrast')[i].value = data.cams.camsettings[i]['contrast'] || 0;
		sliderChangePrevious(document.getElementsByClassName('cams_contrast')[i]);
		document.getElementsByClassName('cams_brightness')[i].value = data.cams.camsettings[i]['brightness'] || 0;
		sliderChangePrevious(document.getElementsByClassName('cams_brightness')[i]);
	}
	for(let i = 0; i < document.getElementsByClassName('presets_name').length; i++){//for each preset
		if(!data.cams.presets[i]) data.cams.presets[i] = {name:"default",width:320,height:240,quality:95,fps:20};
		document.getElementsByClassName('presets_name')[i].value = data.cams.presets[i]['name'];
		document.getElementsByClassName('presets_width')[i].value = data.cams.presets[i]['width'];
		document.getElementsByClassName('presets_height')[i].value = data.cams.presets[i]['height'];
		document.getElementsByClassName('presets_quality')[i].value = data.cams.presets[i]['quality'];
		document.getElementsByClassName('presets_fps')[i].value = data.cams.presets[i]['fps'] || 20;
	}
	for(let i = 0; i < document.getElementsByClassName('macro_name').length; i++){//for each macro
		if(!data.macros[i]) data.macros[i] = {name:"example",cmd:"ls"};
		document.getElementsByClassName('macro_name')[i].value = data.macros[i]['name'];
		document.getElementsByClassName('macro_cmd')[i].value = data.macros[i]['cmd'];
	}
	refreshSelectPresets();
	document.getElementsByClassName('consoleName')[0].value = data['consoleName'];
	document.getElementsByClassName('loadInEditMode')[0].checked = data['loadInEditMode'];
	document.getElementsByClassName('background')[0].value = data['background'];
	document.getElementsByClassName('snaptogrid')[0].checked = data['snaptogrid'];
	document.getElementsByClassName('saveWidgets')[0].checked = data['saveWidgets'];
	document.getElementsByClassName('lockRos')[0].checked = data['lockRos'];
	document.getElementsByClassName('consoleText')[0].value = data['consoleText'] || '';
	document.getElementsByClassName('heartbeat')[0].value = data['heartbeat'] || '';
	document.getElementsByClassName('useUDPVideo')[0].checked = data['useUDPVideo'] || false;
	document.getElementsByClassName('useUDPRos')[0].checked = data['useUDPRos'] || false;
	console.log('done loading settings');
}
function generateConfig(){
	let data = settings.config;
	for(let i = 0; i < document.getElementsByClassName('cams_name').length; i++){
		data.cams.camsettings[i] = {};
		data.cams.camsettings[i]['preset'] = document.getElementsByClassName('cams_preset')[i].value;
		data.cams.camsettings[i]['name'] = document.getElementsByClassName('cams_name')[i].value;
		data.cams.camsettings[i]['rotation'] = document.getElementsByClassName('cams_rotation')[i].value;
		data.cams.camsettings[i]['contrast'] = document.getElementsByClassName('cams_contrast')[i].value;
		data.cams.camsettings[i]['brightness'] = document.getElementsByClassName('cams_brightness')[i].value;
	}
	data.cams.presets = [];
	for(let i = 0; i < document.getElementsByClassName('presets_name').length; i++){
		data.cams.presets[i] = {};
		data.cams.presets[i]['name'] = document.getElementsByClassName('presets_name')[i].value;
		data.cams.presets[i]['width'] = document.getElementsByClassName('presets_width')[i].value;
		data.cams.presets[i]['height'] = document.getElementsByClassName('presets_height')[i].value;
		data.cams.presets[i]['quality'] = document.getElementsByClassName('presets_quality')[i].value;
		data.cams.presets[i]['fps'] = document.getElementsByClassName('presets_fps')[i].value;
	}
	data.macros = [];
	for(let i = 0; i < document.getElementsByClassName('macro_name').length; i++){
		data.macros[i] = {};
		data.macros[i]['name'] = document.getElementsByClassName('macro_name')[i].value;
		data.macros[i]['cmd'] = document.getElementsByClassName('macro_cmd')[i].value;
	}
	data['consoleName'] = document.getElementsByClassName('consoleName')[0].value;
	data['loadInEditMode'] = document.getElementsByClassName('loadInEditMode')[0].checked;
	data['background'] = document.getElementsByClassName('background')[0].value
	data['snaptogrid'] = document.getElementsByClassName('snaptogrid')[0].checked;
	data['saveWidgets'] = document.getElementsByClassName('saveWidgets')[0].checked;
	data['lockRos'] = document.getElementsByClassName('lockRos')[0].checked;
	data['consoleText'] = guardTopicName(document.getElementsByClassName('consoleText')[0].value) || '';
	data['heartbeat'] = guardTopicName(document.getElementsByClassName('heartbeat')[0].value) || '';
	data['useUDPVideo'] = document.getElementsByClassName('useUDPVideo')[0].checked || false;
	data['useUDPRos'] = document.getElementsByClassName('useUDPRos')[0].checked || false;
	return data;
}
function guardTopicName(name){
	let fstr = name.trim();
	str='';
	for(let i = 0; i < fstr.length; i++){
		if(i==0)str = str+fstr.charAt(i).replace(/[^a-zA-Z~/]/g,'');
		else str=str+fstr.charAt(i).replace(/[^a-zA-Z0-9_/]/g,'')
	}
	return str;
}
//theese functions add the DOM for the dynamic settings. c is number of doms to add
function addCams(c){
	for(let i = 0; i < c; i++){
		let html = "<p class='inputLabel'>Default preset</p>"+
		"<select class='cams_preset'></select>"+
		"<p class='inputLabel'>Camera name</p>"+
		"<input class='cams_name'></input>"+
		"<p class='inputLabel'>Rotation</p>"+
		"<select class='cams_rotation'><option value='0'>0&deg</option><option value='1'>90&deg</option><option value='2'>180&deg</option><option value='3'>270&deg</option></select>"+
		"<p class='inputLabel'>Contrast</p>"+
		"<p class='inputLabel'>(50%)</p>"+
		"<input oninput='sliderChangePrevious(this)'class='cams_contrast'type='range' min='-127'max='127'/>"+
		"<p class='inputLabel'>Brightness</p>"+
		"<p class='inputLabel'>(50%)</p>"+
		"<input oninput='sliderChangePrevious(this)'class='cams_brightness'type='range' min='-255'max='255'/>"+
		"<br>";
		document.getElementById('cams').insertAdjacentHTML('beforeend',html);
	}
}
function sliderChangePrevious(ele){
	let min = ele.min;
	let max = ele.max;
	ele.previousSibling.innerText = '('+(-100*(ele.value-min)/(min-max)).toPrecision(3) + '%)';
}
function addPresets(c){
	let allDivs = document.getElementById('presets').querySelectorAll('div.presetdiv');
	for(let i = 0; i < allDivs.length; i++) allDivs[i].remove();
	for(let i = 0; i < c; i++){
		let html = "<div class='presetdiv'><p class='inputLabel'>Preset name</p>"+
		"<input class='presets_name'onkeyup='onPresetNameChage()'></input>"+
		"<p class='inputLabel'>Width (px)</p>"+
		"<input class='presets_width'style='width:50px'></input>"+
		"<p class='inputLabel'>Height (px)</p>"+
		"<input class='presets_height'style='width:50px'></input>"+
		"<p class='inputLabel'>Quality (0-100)</p>"+
		"<input class='presets_quality'style='width:50px'></input>"+
		"<p class='inputLabel'>Max Framerate</p>"+
		"<input class='presets_fps'style='width:50px'></input>"+
		"<button style='margin-left:5px;width:50px'class='presets_delete'onclick='deletePreset(this)'>delete</button>"+
		"<br></div>";
		document.getElementById('presets').insertAdjacentHTML('beforeend',html);
	}
}
function addMacros(c){
	let allDivs = document.getElementById('macros').querySelectorAll('div.macrodiv');
	for(let i = 0; i < allDivs.length; i++) allDivs[i].remove();
	for(let i = 0; i < c; i++){
		let html = "<div class='macrodiv'><p class='inputLabel'>Macro name</p>"+
		"<input class='macro_name'></input>"+
		"<p class='inputLabel'>Command</p>"+
		"<input class='macro_cmd'style='width:650px'></input>"+
		"<button style='margin-left:5px;width:50px'class='presets_delete'onclick='deletePreset(this)'>delete</button>"+
		"<br></div>";
		document.getElementById('macros').insertAdjacentHTML('beforeend',html);
	}
}
function addPreset(){
	let html = "<div class='presetdiv'><p class='inputLabel'>Preset name</p>"+
	"<input class='presets_name'value='default'onkeyup='onPresetNameChage()'></input>"+
	"<p class='inputLabel'>Width (px)</p>"+
	"<input class='presets_width'value='320'style='width:50px'></input>"+
	"<p class='inputLabel'>Height (px)</p>"+
	"<input class='presets_height'value='240'style='width:50px'></input>"+
	"<p class='inputLabel'>Quality (0-100)</p>"+
	"<input class='presets_quality'value='95'style='width:50px'></input>"+
	"<p class='inputLabel'>Max Framerate</p>"+
	"<input class='presets_fps'value='20'style='width:50px'></input>"+
	"<button style='margin-left:5px;width:50px'class='presets_delete'onclick='deletePreset(this)'>delete</button>"+
	"<br></div>";
	document.getElementById('presets').insertAdjacentHTML('beforeend',html);
	refreshSelectPresets();
}
function addMacro(){
	let html = "<div class='macrodiv'><p class='inputLabel'>Macro name</p>"+
	"<input class='macro_name'></input>"+
	"<p class='inputLabel'>Command</p>"+
	"<input class='macro_cmd'style='width:650px'></input>"+
	"<button style='margin-left:5px;width:50px'class='presets_delete'onclick='deletePreset(this)'>delete</button>"+
	"<br></div>";
	document.getElementById('macros').insertAdjacentHTML('beforeend',html);
}
function deletePreset(e){
	if(document.getElementsByClassName('presetdiv').length > 1) e.parentNode.remove();
	refreshSelectPresets();
}
function deleteMacro(e){
	if(document.getElementsByClassName('macrodiv').length > 1) e.parentNode.remove();
}
function onPresetNameChage(){
	refreshSelectPresets();
}
function refreshSelectPresets(){
	let selects = document.getElementsByClassName('cams_preset');
	let prefix_eles = document.getElementsByClassName('presetdiv');
	let prefixes = [];
	for(let i = 0; i < prefix_eles.length; i++){
		prefixes[i] = prefix_eles[i].querySelector('.presets_name').value;
	}
	for(let i = 0; i < selects.length; i++){
		let g = selects[i].value || 0;
		selects[i].innerHTML = '';
		for(let k = 0; k < prefixes.length; k++){
			selects[i].innerHTML += '<option value="'+k+'">'+prefixes[k]+'</option>';
		}
		if(g < prefixes.length) selects[i].value = g;
		else selects[i].value = 0;
	}
}
function sendToServer(){
	let data = generateConfig();
	document.getElementById('header').innerText = 'Sending...';
	socket.emit('configSettings',data);
	console.log('sent config to server');
	socket.emit('WCTS',settings['widgets']);
	console.log('sent widgets to server');
	document.getElementById('header').innerText = 'Success';
	return;
}
function exportFile(){
	settings['config'] = generateConfig();
	
	var data = encode( JSON.stringify(settings, null, 4) );
    var blob = new Blob( [ data ], {
        type: 'application/octet-stream'
    });
    url = URL.createObjectURL( blob );
    var link = document.createElement( 'a' );
    link.setAttribute( 'href', url );
    link.setAttribute( 'download', 'RobotConsole.json' );
    var event = document.createEvent( 'MouseEvents' );
    event.initMouseEvent( 'click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
    link.dispatchEvent( event );
}
function encode(s) {
    var out = [];
    for ( var i = 0; i < s.length; i++ ) {
        out[i] = s.charCodeAt(i);
    }
    return new Uint8Array( out );
}
function loadJsonFile(me){
	console.log('got file');
	var reader = new FileReader();
	reader.addEventListener('load',function(){
		var result = JSON.parse(reader.result);
		console.log(result);
		populateConfig(result['config']);
		settings['widgets'] = result['widgets'];
		me.value = '';
	});
	reader.readAsText(me.files[0]);
}
function backToConsole(){
	if(gotSettings) sendToServer();
	window.location.href = window.location.href.replace('/config.html','');
}
function showMessage(text){
	mask.style.display = 'inline';
	document.getElementById('messagePanel').style.display = 'flex';
	document.getElementById('messagePanelText').innerText = text;
}
function hideMessage(){
	mask.style.display = 'none';
	document.getElementById('messagePanel').style.display = 'none';
}
function exitServer(d){
	console.log('exiting server...');
	socket.emit('exit',d);
	//uncomment below to reset the web page too
	showMessage('Restarting Server...');
	//location.reload();
}