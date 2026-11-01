(function(root){
  'use strict';
  const looks=Object.freeze({
    blue:{name:'Original',color:'#47A8FF',filter:'none'},
    lavender:{name:'Lavender',color:'#9D9DFF',filter:'hue-rotate(60deg)'},
    pearl:{name:'Pearl',color:'#F5F5F5',filter:'grayscale(1) brightness(1.6)'},
    amber:{name:'Amber',color:'#FFB067',filter:'hue-rotate(190deg)'},
    rose:{name:'Rose',color:'#F377BC',filter:'hue-rotate(115deg)'},
    coral:{name:'Coral',color:'#F87171',filter:'hue-rotate(155deg)'},
    gold:{name:'Gold',color:'#F4D35E',filter:'hue-rotate(215deg)'},
    green:{name:'Green',color:'#4ADE80',filter:'hue-rotate(-70deg)'},
    teal:{name:'Teal',color:'#22D3C5',filter:'hue-rotate(-30deg)'},
    violet:{name:'Violet',color:'#C084FC',filter:'hue-rotate(85deg)'}
  });
  if(typeof module==='object'&&module.exports)module.exports=looks;else root.CODYLooks=looks;
})(globalThis);
