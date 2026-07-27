export interface WorkflowModule{
  name:string;
  route:string;
  enabled:boolean;
}

export const MODULES:WorkflowModule[]=[

{
name:"Student Attendance",
route:"/school/student-attendance",
enabled:true
},

{
name:"Teacher Attendance",
route:"/school/teacher-attendance",
enabled:true
},

{
name:"Create Roles",
route:"/school/create-roles",
enabled:true
},

{
name:"Syllabus Management",
route:"/school/syllabus-management?academicYearId=77",
enabled:true
},

{
name:"Simple Timetable",
route:"/school/administration/simple-timetable",
enabled:true
},

{
name:"Profile",
route:"/school/profile",
enabled:true
}

];
