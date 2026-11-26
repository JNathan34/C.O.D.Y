'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {parseNoteCommand,parseDrawingScope}=require('../src/sticky-notes/commands');
const {StickyNotes,placeNote}=require('../src/sticky-notes/manager');
const {IslandUtilities}=require('../src/island-utilities');
const display={id:1,workArea:{x:0,y:0,width:1600,height:900}};
function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cody-notes-test-'));
  const ipc=new EventEmitter();ipc.handle=(name,fn)=>ipc[name]=fn;ipc.removeHandler=name=>delete ipc[name];
  const windows=[],neutral=[];let monitors=[display];
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.messages=[];this.webContents=new EventEmitter();Object.assign(this.webContents,{mainFrame:{},getURL:()=>this.url,setWindowOpenHandler:fn=>this.openHandler=fn,send:(...args)=>this.messages.push(args)});windows.push(this);}
    getNativeWindowHandle(){const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(windows.indexOf(this)+100));return bytes;}
    setAlwaysOnTop(){}setVisibleOnAllWorkspaces(){}
    async loadFile(file){this.url=require('node:url').pathToFileURL(file).href;}
    show(){this.visible=true;this.focused=true;}showInactive(){this.visible=true;}
    hide(){this.visible=false;}isVisible(){return this.visible;}isDestroyed(){return this.destroyed===true;}
    getBounds(){return this.bounds;}setBounds(bounds){this.bounds=bounds;}
    destroy(){this.destroyed=true;this.emit('closed');}
  }
  const options={BrowserWindow:Window,ipcMain:ipc,file:path.join(directory,'sticky-notes.json'),displays:()=>monitors,primary:()=>display,neutralWindow:async(...args)=>neutral.push(args)};
  const notes=new StickyNotes(options);
  t.after(()=>{notes.close();fs.rmSync(directory,{recursive:true,force:true});});
  const event=window=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
  return {notes,options,ipc,windows,neutral,event,monitors:value=>monitors=value};
}
test('natural blank Post-it requests route locally, including dictation variants',async()=>{
  const created=[];const utilities=new IslandUtilities({stickyNotes:{create:async args=>created.push(args)}});
  for(const text of ['Give me a blank Post-it note','Cody can you give me an empty postet note please','Open a new sticky note','Make a blank postat note in the top left corner','I want a blank sticky note that I can type in and move around the screen','A blank Post-it note']){
    const route=utilities.match(text,{spoken:true});assert.equal(route.action,'sticky-note.create',text);
    const result=await utilities.run(text,'test',{route});assert.equal(result.handled,true);assert.match(result.reply,/blank sticky note/);
  }
  assert.equal(created[3].position,'top-left');assert.ok(created.every(args=>args.text===''));
  assert.deepEqual(parseNoteCommand('Create a sticky note saying "Remember Milk"').args,{text:'Remember Milk',position:'top-right'});
  for(const text of ['Draw a note about photosynthesis','Create a sticky note with information about the tallest building','Explain what sticky notes are','Give me a blank Word document'])assert.equal(parseNoteCommand(text),null,text);
});
test('scope changes require a drawing command and run without AI or computer use',async()=>{
  const scopes=[],utilities=new IslandUtilities({drawingScope:async args=>scopes.push(args)});
  await utilities.run('Keep this drawing visible across all apps','test');
  await utilities.run('Only show this drawing on its original app','test');
  assert.deepEqual(scopes,[{global:true},{global:false}]);
  assert.equal(parseDrawingScope('Why do all apps need updates?'),null);
  assert.equal(parseDrawingScope('Make a drawing of a house visible on all apps'),null);
  assert.equal(parseDrawingScope('Keep this drawing visible when I switch apps').args.global,true);
  assert.equal(parseNoteCommand('Make a sticky note saying Remember Milk!').args.text,'Remember Milk!');
});
test('note positions fit permitted displays and preserve negative monitor coordinates',()=>{
  const second={id:2,workArea:{x:-1280,y:-100,width:1280,height:800}};
  assert.deepEqual(placeNote(null,[second],second,'top-left'),{x:-1262,y:-82,width:300,height:280});
  assert.deepEqual(placeNote({x:-4000,y:1800,width:4000,height:4000},[display],display),{x:0,y:0,width:1600,height:900});
  assert.equal(placeNote(null,[],null),null);
  const kept=placeNote({x:-1000,y:50,width:300,height:280},[display,second],display);assert.equal(kept.x,-1000);
});
test('typing, moving, restart, and deletion preserve notes and isolate renderer IPC',async t=>{
  const {notes,options,ipc,windows,neutral,event}=setup(t);
  const {id}=await notes.create();const win=windows[0];
  assert.equal(win.focused,true);assert.equal(win.options.webPreferences.sandbox,true);assert.equal(win.options.webPreferences.nodeIntegration,false);
  assert.deepEqual(neutral[0],['100',true]);
  const own=event(win);assert.deepEqual(await ipc['sticky-note:read'](own),{text:''});
  assert.throws(()=>ipc['sticky-note:read']({...own,senderFrame:{}}),/Unknown/);
  ipc.emit('sticky-note:write',{...own,senderFrame:{}},'forged');assert.equal(notes.notes.get(id).text,'');
  const text='My shopping list\nMilk & eggs <script>plain text</script> 📝';
  ipc.emit('sticky-note:write',own,text);win.bounds={x:180,y:120,width:360,height:320};win.emit('move');notes.save();
  const stored=JSON.parse(fs.readFileSync(options.file,'utf8')).notes[0];assert.equal(stored.text,text);assert.deepEqual(stored.bounds,win.bounds);
  notes.close();assert.equal(win.isDestroyed(),true);assert.equal(JSON.parse(fs.readFileSync(options.file,'utf8')).notes.length,1);
  const restored=new StickyNotes(options);t.after(()=>restored.close());await restored.restore();
  const next=windows[1];assert.equal(next.focused,undefined);assert.equal(next.visible,true);assert.equal(restored.notes.get(id).text,text);assert.deepEqual(next.bounds,stored.bounds);
  ipc.emit('sticky-note:close',event(next));assert.equal(next.isDestroyed(),true);assert.deepEqual(JSON.parse(fs.readFileSync(options.file,'utf8')).notes,[]);restored.close();
});
test('restricted or removed monitors move notes into permitted work areas',async t=>{
  const {notes,windows,monitors}=setup(t);await notes.create();const win=windows[0];
  monitors([]);await notes.reconcile();assert.equal(win.visible,false);
  const small={id:9,workArea:{x:-800,y:0,width:600,height:400}};monitors([small]);await notes.reconcile();
  assert.equal(win.visible,true);assert.ok(win.bounds.x>=-800&&win.bounds.x+win.bounds.width<=-200);
});
