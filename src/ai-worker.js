let engine=null,vision=null,processor=null,textId=null;
const emit=(task,detail)=>self.postMessage({event:'progress',task,...detail});
async function unloadText(){if(engine){await engine.unload();engine=null;textId=null;self.postMessage({event:'unloaded',task:'text'});}}
async function unloadVision(){if(vision){await vision.dispose();vision=null;processor=null;self.postMessage({event:'unloaded',task:'vision'});}}
async function loadText(){
 if(engine)return textId;
 if(!self.navigator.gpu)throw Error('이 브라우저는 WebGPU를 지원하지 않아요. 최신 데스크톱 Chrome 또는 Edge에서 AI를 준비해주세요. 기본 상담과 배치는 계속 사용할 수 있어요.');
 const adapter=await self.navigator.gpu.requestAdapter();if(!adapter)throw Error('사용 가능한 GPU를 찾지 못했어요. 브라우저 하드웨어 가속을 확인해주세요.');
 await unloadVision();
 const {MLCEngine,prebuiltAppConfig}=await import('@mlc-ai/web-llm');
 const preferred=adapter.features.has('shader-f16')?'gemma3-1b-it-q4f16_1-MLC':'Qwen3-0.6B-q4f32_1-MLC';
 if(!prebuiltAppConfig.model_list.some(x=>x.model_id===preferred))throw Error('이 버전에서 지원하는 모델을 찾지 못했어요.');
 engine=new MLCEngine({initProgressCallback:r=>emit('text',{progress:r.progress,text:r.text})});
 try{await engine.reload(preferred);textId=preferred;return preferred;}catch(e){await unloadText();throw e;}
}
async function loadVision(device='webgpu'){
 if(vision)return;
 await unloadText();
 const {AutoProcessor,AutoModelForVision2Seq,env}=await import('@huggingface/transformers');
 env.allowLocalModels=false;env.backends.onnx.wasm.numThreads=1;
 if(device==='webgpu'&&(!self.navigator.gpu||!await self.navigator.gpu.requestAdapter()))throw Error('사진 AI에 사용할 GPU가 없어요. AI 설정에서 사진 분석을 CPU 호환 모드로 바꿀 수 있어요.');
 const modelId='HuggingFaceTB/SmolVLM-256M-Instruct';
 const progress_callback=r=>emit('vision',{status:r.status,file:r.file,loaded:r.loaded,total:r.total,progress:typeof r.progress==='number'?r.progress/100:undefined,text:r.status==='progress'?`${r.file||'모델'} 다운로드`:'사진 모델 준비 중'});
 processor=await AutoProcessor.from_pretrained(modelId,{progress_callback});
 try{vision=await AutoModelForVision2Seq.from_pretrained(modelId,{dtype:'q4',device,progress_callback});}catch(e){processor=null;throw e;}
}
const schema={type:'object',properties:{seats:{type:['integer','null'],enum:[1,2,3,4,null]},size:{type:'string',enum:['unknown','compact','standard','large']},depth_profile:{type:'string',enum:['unknown','shallow','deep']},height_profile:{type:'string',enum:['unknown','low','tall']},reply:{type:'string'}},required:['seats','size','depth_profile','height_profile','reply'],additionalProperties:false};
async function chat(payload){
 await loadText();
 const a=payload.item;
 const state={type:a.type,width_cm:a.dims[0],depth_cm:a.dims[2],overall_height_cm:a.dims[1]};
 const prompt=`가구 상담 도우미입니다. 사용자의 설명에서 크기 단서만 추출하고, 한국어로 짧게 답하세요. 실측값은 모릅니다. 보이지 않는 크기를 지어내지 마세요. 출력은 JSON만 쓰세요.
seats: 소파 인원수 1~4, 모르면 null.
size: 작은 가구 compact, 보통 standard, 큰 가구 large, 단서 없으면 unknown.
depth_profile: 얕으면 shallow, 깊으면 deep, 모르면 unknown.
height_profile: 낮으면 low, 높으면 tall, 모르면 unknown.
reply: 크기 단서를 반영하고 필요한 질문 하나를 하는 한국어 문장. 사용자 문장을 반복하지 마세요.
예시 사용자: 세 명이 앉는 낮은 소파야.
예시 응답: {"seats":3,"size":"unknown","depth_profile":"unknown","height_profile":"low","reply":"3인용의 낮은 소파로 가늠해볼게요. 앉는 부분도 깊은 편인가요?"}
예시 사용자: 작은 책상이야. 깊이는 잘 몰라.
예시 응답: {"seats":null,"size":"compact","depth_profile":"unknown","height_profile":"unknown","reply":"작은 책상을 기준으로 잡을게요. 노트북 하나를 놓는 정도인가요?"}
현재 가구: ${JSON.stringify(state)}
직전 대화: ${JSON.stringify(payload.messages.slice(-5,-1))}
사진 설명: ${JSON.stringify((payload.caption||'없음').slice(0,300))}
사용자: ${payload.messages.at(-1)?.content||''}
응답 JSON:`;
 const r=await engine.chat.completions.create({messages:[{role:'user',content:prompt}],max_tokens:220,temperature:.1,response_format:{type:'json_object',schema:JSON.stringify(schema)},...(textId.startsWith('Qwen3')?{extra_body:{enable_thinking:false}}:{})});
 if(r.choices[0]?.finish_reason==='length')throw Error('AI 응답이 길어져 중단했어요. 문장을 짧게 해서 다시 시도해주세요.');
 return r.choices[0]?.message?.content||'';
}
async function caption(payload){
 await loadVision(payload.device);
 const {load_image,TextStreamer}=await import('@huggingface/transformers');
 const messages=[{role:'user',content:[{type:'image',image:payload.image},{type:'text',text:'Describe the main piece of furniture: its category, shape, color, and visible seating. Do not estimate centimeters or physical dimensions. Be concise.'}]}];
 const prompt=processor.apply_chat_template(messages,{add_generation_prompt:true});
 const image=await load_image(payload.image);
 const inputs=await processor(prompt,[image],{do_image_splitting:false});
 let text='';
 const result=await vision.generate({...inputs,max_new_tokens:96,do_sample:false,streamer:new TextStreamer(processor.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:s=>{text+=s;}})});
 if(!text.trim()){const ids=result.slice(null,[inputs.input_ids.dims[1],null]);text=processor.batch_decode(ids,{skip_special_tokens:true})[0];}
 return text.trim();
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{try{let result;switch(data.task){case 'load-text':result=await loadText();break;case 'chat':result=await chat(data.payload);break;case 'caption':result=await caption(data.payload);break;case 'unload':await unloadText();await unloadVision();result=true;break;default:throw Error('알 수 없는 AI 요청');}self.postMessage({id:data.id,result});}catch(e){self.postMessage({id:data.id,error:e.message||String(e)});}});};
