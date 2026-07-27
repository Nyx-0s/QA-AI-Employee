import {Page} from "playwright";

export class ExecutionVerifier{

static async snapshot(page:Page){

return{
url:page.url(),
title:await page.title(),
html:await page.locator("body").innerHTML()
};

}

static changed(a:any,b:any){

return a.url!==b.url||
a.title!==b.title||
a.html!==b.html;

}

}
