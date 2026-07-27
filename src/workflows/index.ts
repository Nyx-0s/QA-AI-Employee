import 'dotenv/config';
import { WorkflowRunner } from './core/WorkflowRunner';

new WorkflowRunner().run().catch(console.error);
