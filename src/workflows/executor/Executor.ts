import {Page} from "playwright";
import {ExecutionPlanner} from "../planner/ExecutionPlanner";
import {ExecutionVerifier} from "../verifier/ExecutionVerifier";
import {PageObserver} from "../engine/PageObserver";
import {safe} from "../actions/SafeActions";

export class Executor{

static async run(page:Page){

const observation=await PageObserver.observe(page);
const plan=ExecutionPlanner.build(observation);

console.log("\nExecution Plan");
console.table(plan.map(x=>({type:x.type,target:x.target})));

for(const step of plan){

const before=await ExecutionVerifier.snapshot(page);

try{

if(step.type==="button"){

if(!safe(step.target)) continue;

const btn=page.getByRole("button",{name:step.target}).first();

if(await btn.count()){

await btn.click({timeout:3000}).catch(()=>{});
await page.waitForTimeout(1000);

}

}

if(step.type==="input"){

const input=page.locator("input").filter({visible:true}).first();

if(await input.count()){

await input.fill("AI").catch(()=>{});
await page.waitForTimeout(500);

}

}

const after=await ExecutionVerifier.snapshot(page);

if(ExecutionVerifier.changed(before,after))
console.log("✓",step.type,step.target);
else
console.log("-",step.type,step.target);

await page.keyboard.press("Escape").catch(()=>{});

}catch{

console.log("✗",step.type,step.target);

}

}

}

}
