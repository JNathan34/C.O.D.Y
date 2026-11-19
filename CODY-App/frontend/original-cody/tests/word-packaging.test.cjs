'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../../..');
const {runPowerShell,psQuote}=require('../src/control/windows');
const {referenceLayout}=require('../src/control/word-document');

test('a Word reference supplies editable-layout cues without launching Word',{
  skip:process.platform!=='win32'
},async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-word-reference-'));
  try{
    const source=path.join(folder,'package'),file=path.join(folder,'Reference.docx');
    fs.mkdirSync(path.join(source,'word'),{recursive:true});
    fs.writeFileSync(path.join(source,'word','document.xml'),`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <w:body>
          <w:p><w:r><w:drawing><wp:anchor><wp:extent cx="2286000"/>
            <wp:positionH><wp:align>right</wp:align></wp:positionH><wp:wrapSquare/>
          </wp:anchor></w:drawing></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pageBreakBefore/><w:spacing w:after="240"/></w:pPr></w:p>
        </w:body>
      </w:document>`);
    await runPowerShell(`Add-Type -AssemblyName System.IO.Compression.FileSystem
      Add-Type -AssemblyName System.IO.Compression
      $archive=[IO.Compression.ZipFile]::Open(${psQuote(file)},[IO.Compression.ZipArchiveMode]::Create)
      try{[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,${psQuote(path.join(source,'word','document.xml'))},'word/document.xml')}
      finally{$archive.Dispose()}`);
    assert.deepEqual(await referenceLayout(file),{name:'Reference.docx',paragraphs:[
      {paragraph:1,picture:{kind:'anchor',wrap:'wrapSquare',align:'right',widthPoints:180}},
      {paragraph:2,style:'Heading1',pageBreak:true,afterTwips:'240'},
    ]});
  }finally{
    fs.unlinkSync(path.join(folder,'package','word','document.xml'));
    if(fs.existsSync(path.join(folder,'Reference.docx')))fs.unlinkSync(path.join(folder,'Reference.docx'));
    fs.rmdirSync(path.join(folder,'package','word'));fs.rmdirSync(path.join(folder,'package'));fs.rmdirSync(folder);
  }
});

test('Word snapshot fingerprints after reading lazy shape metadata',{
  skip:process.platform!=='win32'
},async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../windows/word-document.ps1'),'utf8');
  const snapshot=source.slice(source.indexOf('function Fingerprint('),source.indexOf("if($payload.mode -ne 'execute')"));
  const xml='<w:document><w:shapeDefaults/><w:t>Original</w:t></w:document>';
  const setup=`
$document=[pscustomobject]@{Name='Scratch';FullName='Scratch';Saved=$false;ReadOnly=$false;Content=[pscustomobject]@{WordOpenXML='<w:document/>'};Paragraphs=@{Count=0};InlineShapes=@{Count=0}}
$document|Add-Member -MemberType ScriptProperty -Name Shapes -Value {$this.Content.WordOpenXML=${psQuote(xml)};return @{Count=0}}
$word=[pscustomobject]@{ActiveDocument=$document;ActiveWindow=@{Hwnd=123};Selection=@{Range=@{StoryType=1;Start=0;End=0;Text=''}}}
$payload=@{mode='snapshot'}
`;
  const result=JSON.parse(await runPowerShell(setup+snapshot));
  assert.equal(result.target.fingerprint,require('node:crypto').createHash('sha256').update(xml).digest('base64'));
});

test('Word fingerprints ignore multiline session IDs but detect content and formatting edits',{
  skip:process.platform!=='win32'
},async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../windows/word-document.ps1'),'utf8');
  const fingerprint=source.slice(source.indexOf('function Fingerprint('),source.indexOf('function CheckedDocument'));
  const xml=(id,text='Original',bold='')=>`<w:document><w:rsids>\r\n<w:rsid w:val="${id}"/>\r\n</w:rsids><w:p w:rsidR="${id}"><w:r>${bold}<w:t>${text}</w:t></w:r></w:p></w:document>`;
  const hashes=JSON.parse(await runPowerShell(fingerprint+'\n@('+[
    xml('00000001'),xml('00000002'),xml('00000002','Edited'),xml('00000002','Original','<w:rPr><w:b/></w:rPr>')
  ].map(value=>`(Fingerprint ([pscustomobject]@{Content=[pscustomobject]@{WordOpenXML=${psQuote(value)}}}))`).join(',')+')|ConvertTo-Json -Compress'));
  assert.equal(hashes[0],hashes[1]);assert.notEqual(hashes[0],hashes[2]);assert.notEqual(hashes[0],hashes[3]);
});

test('Word fingerprints ignore fresh floating drawing IDs while detecting placement and wrapping changes',{
  skip:process.platform!=='win32'
},async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../windows/word-document.ps1'),'utf8');
  const fingerprint=source.slice(source.indexOf('function Fingerprint('),source.indexOf('function CheckedDocument'));
  const xml=(id,align='right',wrap='wrapSquare')=>`<wp:anchor wp14:anchorId="${id}" wp14:editId="${id}"><wp:align>${align}</wp:align><wp:${wrap}/></wp:anchor>`;
  const cases=[xml('00000001'),xml('00000002'),xml('00000002','left'),xml('00000002','right','wrapTight')];
  const hashes=JSON.parse(await runPowerShell(fingerprint+'\n@('+cases
    .map(value=>`(Fingerprint ([pscustomobject]@{Content=[pscustomobject]@{WordOpenXML=${psQuote(value)}}}))`)
    .join(',')+')|ConvertTo-Json -Compress'));
  assert.equal(hashes[0],hashes[1]);
  assert.notEqual(hashes[1],hashes[2]);assert.notEqual(hashes[1],hashes[3]);
});

test('packaged Word module runs its extracted helper through real PowerShell',{
  skip:process.platform!=='win32',timeout:45000
},async()=>{
  const asar=require(path.join(root,'node_modules/@electron/asar'));
  const config=require(path.join(root,'electron-builder.standalone.cjs'));
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cody-word-package-'));
  try{
    const source=path.join(folder,'source'),archive=path.join(folder,'app.asar');
    fs.mkdirSync(path.join(source,'src/control'),{recursive:true});
    fs.mkdirSync(path.join(source,'windows'));
    for(const file of ['word-document.js','windows.js'])fs.copyFileSync(path.join(__dirname,'../src/control',file),path.join(source,'src/control',file));
    // This helper checks both the physical script path and the stdin payload without touching Word.
    fs.writeFileSync(path.join(source,'windows/word-document.ps1'),`if($payload.mode -ne 'snapshot'){throw 'Missing stdin payload'}\n@{ok=$true;target=@{fingerprint='packaged';window='123'}}|ConvertTo-Json -Compress`);
    await asar.createPackageWithOptions(source,archive,{unpack:'**/{'+config.asarUnpack.join(',')+'}'});
    assert.ok(fs.existsSync(archive+'.unpacked/windows/word-document.ps1'));
    const harness=path.join(folder,'verify.cjs');
    fs.writeFileSync(harness,`const {app}=require('electron');\napp.whenReady().then(async()=>{try{const word=require(${JSON.stringify(archive+'/src/control/word-document.js')});const assert=require('node:assert/strict');const result=await word.snapshot();assert.equal(result.target.fingerprint,'packaged');await assert.rejects(word.execute({steps:[{type:'save'}]},null),{message:'Missing stdin payload'});console.log('PACKAGED_WORD_OK');app.exit(0);}catch(error){console.error(error);app.exit(1);}});`);
    const result=await new Promise((resolve,reject)=>{
      const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
      const child=spawn(require(path.join(root,'node_modules/electron')),[harness,'--user-data-dir='+path.join(folder,'profile')],{env,windowsHide:true});
      let output='';const timer=setTimeout(()=>{child.kill();reject(Error('Packaged Word check timed out'));},35000);
      child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
    });
    assert.equal(result.code,0,result.output);assert.match(result.output,/PACKAGED_WORD_OK/);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
