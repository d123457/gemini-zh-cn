const asar=require(process.argv[2]+"/lib/asar");
const path=require("path"),fs=require("fs");
const APP=path.join(process.env.LOCALAPPDATA,"Google","Gemini","app-1.21.1","resources","app.asar");
const p=asar.parseAsar(APP);
const files=asar.readAll(p);
fs.writeFileSync(process.argv[2]+"/tools/page-extract.js", files.get("src/zhcn/page.js").toString("utf8"));
console.log("extracted", files.get("src/zhcn/page.js").length, "bytes");
