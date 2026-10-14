const DEFAULT_MODEL='deepseek/deepseek-v4.1-flash';
// Explicit IDs: never strip :free or silently fall back to a paid model.
const MODELS=[
  {id:DEFAULT_MODEL,name:'DeepSeek V4.1 Flash',contextWindow:1048576},
  {id:'deepseek/deepseek-v4-pro',name:'DeepSeek V4 Pro (0423)',contextWindow:1048576},
  {id:'google/gemini-3.5-flash-lite',name:'Gemini 3.5 Flash Lite',contextWindow:1048576},
  {id:'google/gemma-4-31b-it',name:'Gemma 4 31B',contextWindow:262144,reasoningEffort:false},
  {id:'openrouter/free',name:'Free · автоматический выбор',contextWindow:200000,free:true},
  {id:'qwen/qwen3.8-27b:free',name:'Qwen 3.8 27B',contextWindow:262144,free:true},
  {id:'nvidia/nemotron-3.5-lightning:free',name:'Nemotron 3.5 Lightning',contextWindow:1000000,free:true,reasoningEffort:false},
  {id:'thinkingmachines/inkling-small:free',name:'Inkling Small',contextWindow:1048576,free:true},
  {id:'thinkingmachines/inkling:free',name:'Inkling',contextWindow:1048576,free:true},
  {id:'nvidia/nemotron-3-ultra-550b-a55b:free',name:'Nemotron 3 Ultra 550B A55B',contextWindow:1000000,free:true},
  {id:'nvidia/nemotron-3-super-120b-a12b:free',name:'Nemotron 3 Super 120B A12B',contextWindow:262144,free:true}
];
function resolveModel(id=DEFAULT_MODEL){const model=MODELS.find(m=>m.id===id);if(!model)throw new Error('Неизвестная модель OpenRouter');return model;}
module.exports={DEFAULT_MODEL,MODELS,resolveModel};
