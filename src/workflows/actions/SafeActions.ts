export const BLOCKED=[
"delete",
"remove",
"terminate",
"demote",
"drop",
"cancel",
"reject",
"archive",
"reset",
"logout"
];

export function safe(text:string){

const t=text.toLowerCase();

return !BLOCKED.some(x=>t.includes(x));

}
