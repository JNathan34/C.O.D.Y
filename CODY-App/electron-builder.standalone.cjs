'use strict';
const path=require('node:path');
const root=__dirname;
const version=require('./frontend/original-cody/package.json').version;
module.exports={
 appId:'uk.cody.integrated',productName:'C.O.D.Y',electronVersion:'38.8.6',asar:true,concurrency:{jobs:1},
 publish:{provider:'github',owner:'JNathan34',repo:'C.O.D.Y',releaseType:'draft'},
 directories:{app:path.join(root,'build/standalone-app'),buildResources:path.join(root,'build/installer'),output:path.join(root,'dist','standalone-'+version)},
 files:['src/**/*','assets/**/*','windows/**/*','ui/**/*','node_modules/**/*','package.json','!**/tests/**/*'],
 extraResources:[{from:path.join(root,'run/current'),to:'native-engine',filter:['**/*','!**/*.log','!**/*.pdb']}],
 asarUnpack:['windows/**/*','src/voice/*.ps1','src/voice/*.py'],
 win:{icon:path.join(root,'frontend/original-cody/assets/brand/cody.ico'),target:[{target:'nsis',arch:['x64','arm64']}],signExecutable:false,artifactName:'C.O.D.Y-Setup-${version}-${arch}.${ext}'},
 nsis:{buildUniversalInstaller:false,oneClick:false,perMachine:false,useZip:true,differentialPackage:false,preCompressedFileExtensions:[],allowToChangeInstallationDirectory:true,createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:'C.O.D.Y',include:path.join(root,'build/installer/standalone.nsh'),deleteAppDataOnUninstall:false,runAfterFinish:true},
 afterPack:path.join(root,'tools/audit-standalone.cjs')
};
