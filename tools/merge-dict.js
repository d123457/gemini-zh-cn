const fs=require("fs");
const p=process.argv[2]+"/dict/zh-CN.json";
const d=JSON.parse(fs.readFileSync(p,"utf8"));
const add={
 "Notebooks":"笔记本","New notebook":"新建笔记本","New Notebook":"新建笔记本",
 "Tasks":"任务","Task":"任务","Chats":"对话","Chat":"对话","All":"全部",
 "Settings":"设置","Search":"搜索","Share":"共享","Send":"发送",
 "Attach files":"添加文件","Microphone":"麦克风","Search chats":"搜索对话",
 "Show more":"显示更多","Show less":"收起","See all":"查看全部",
 "Rename":"重命名","Delete":"删除","Pin":"置顶","Unpin":"取消置顶",
 "Help":"帮助","Feedback":"反馈","Sign out":"退出登录","Switch account":"切换账号",
 "Copy":"复制","Copied":"已复制","Edit":"编辑","Retry":"重试","Stop":"停止",
 "Sources":"来源","Show thinking":"显示思考过程","Hide thinking":"隐藏思考过程",
 "Extensions":"扩展程序","Gems":"Gems","Canvas":"Canvas","Deep Research":"深度研究",
 "Gemini API Key for Agent Integration":"Gemini API 密钥（用于 Agent 集成）"
};
let n=0; for(const k in add){ if(!(k in d)){ d[k]=add[k]; n++; } }
const sorted={}; Object.keys(d).sort().forEach(k=>sorted[k]=d[k]);
fs.writeFileSync(p, JSON.stringify(sorted,null,2));
console.log("added",n,"total",Object.keys(sorted).length);
