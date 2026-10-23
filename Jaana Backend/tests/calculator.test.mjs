import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../assets/js/calculator.js',import.meta.url),'utf8');
function calculator(){
 const timers=new Map();let timerId=0,selection=0;
 class Element{
  constructor(){this.value='';this.hidden=true;this.children=[];this.events={};this.attributes={};this.disabled=false;}
  get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  fire(name,event={}){for(const fn of this.events[name]||[])fn({target:this,preventDefault(){},...event});}
  setAttribute(name,value){this.attributes[name]=value;}removeAttribute(name){delete this.attributes[name];}
  replaceChildren(){this.children=[];}appendChild(child){this.children.push(child);}
  querySelectorAll(){return this.children;}scrollIntoView(){}
 }
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const form=get('rate-form');form.elements=Object.fromEntries(['pickup','destination','weight','packages','size'].map(n=>[n,new Element()]));form.elements.weight.value='8';form.elements.packages.value='1';form.elements.size.value='Medium parcel (box or bag)';form.reportValidity=form.checkValidity=()=>true;
 const doc={getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element(),activeElement:null};
 const requests=[];
 const context={document:doc,window:{location:{}},sessionStorage:{getItem:()=>null,setItem(){}},FormData:class{constructor(){return Object.entries(form.elements).map(([k,v])=>[k,v.value]);}},Intl,AbortController,AbortSignal,Event,console,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{
  requests.push({url,options});
  if(url==='/api/pricing')return {ok:true,json:async()=>({perKm:300,minimum:2000})};
  if(url==='/api/estimate')return {ok:true,json:async()=>({distanceKm:12,rates:{perKm:300,minimum:2000},distanceCharge:3600,weightCharge:500,total:4100})};
  if(url.includes('Failure'))return {ok:false,json:async()=>({error:'Address suggestions are temporarily unavailable.'})};
  return {ok:true,json:async()=>({suggestions:[{label:'Selected address '+(++selection),token:'signed-token-'+selection}]})};
 }};
 vm.runInNewContext(source,context);
 async function settle(){await new Promise(resolve=>setImmediate(resolve));}
 async function run(ms){for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);await timer.fn();}await settle();}
 async function type(name,value){const input=form.elements[name];doc.activeElement=input;input.value=value;input.fire('input');form.fire('input',{target:input});await run(400);}
 async function select(name){await type(name,'Address '+name);get(name==='pickup'?'pickup-suggestions':'destination-suggestions').children[0].fire('click');await settle();}
 return {form,get,doc,requests,run,type,select,settle};
}
test('autocomplete does not reopen after blur and errors are visible',async()=>{
 const c=calculator(),input=c.form.elements.pickup;c.doc.activeElement=input;input.value='Ikeja';input.fire('input');input.fire('blur');c.doc.activeElement=null;
 await c.run(150);await c.run(400);assert.equal(c.get('pickup-suggestions').hidden,true);assert(!c.requests.some(r=>r.url.startsWith('/api/locations')));
 await c.type('pickup','Failure address');assert.match(c.get('rate-feedback').textContent,/temporarily unavailable/);
});
test('suggestion selection is required and editing weight cannot send an old WhatsApp quote',async()=>{
 const c=calculator();c.form.fire('submit');await c.settle();assert(!c.requests.some(r=>r.url==='/api/estimate'));
 await c.select('pickup');await c.select('destination');c.form.fire('submit');await c.settle();assert(c.requests.some(r=>r.url==='/api/estimate'));assert.equal(c.get('continue-booking').disabled,false);
 c.form.elements.weight.value='21';c.form.fire('input',{target:c.form.elements.weight});assert.equal(c.get('custom-quotation').hidden,false);assert.equal(c.get('continue-booking').disabled,true);
 c.get('rate-contact').fire('click');const message=new URL(c.get('rate-contact').href).searchParams.get('text');assert.match(message,/weight: 21/);assert(!message.includes('4,100'));assert(!message.includes('Token'));assert(!message.includes('signed-token'));
});
test('Reset clears selected-location proof tokens as well as the visible estimate',async()=>{
 const c=calculator();await c.select('pickup');await c.select('destination');c.form.fire('reset');c.form.fire('submit');await c.settle();assert(!c.requests.some(r=>r.url==='/api/estimate'));assert.match(c.get('rate-feedback').textContent,/select both addresses/);
});
