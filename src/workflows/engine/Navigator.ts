import { Page } from "playwright";

export class Navigator {

constructor(private page: Page){}

async open(name:string){

const target=this.page
.getByRole("button",{name:new RegExp(name,"i")})
.or(this.page.getByRole("link",{name:new RegExp(name,"i")}));

await target.first().click();

}

}
