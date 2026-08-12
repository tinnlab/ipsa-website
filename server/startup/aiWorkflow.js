// Initialize AI Workflow at server startup
import { Meteor } from 'meteor/meteor';

Meteor.startup(async () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Initializing AI Workflow System      ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    console.log('✅ AI Workflow System ready!');
    console.log('Note: Fact-checking runs as separate Python API service\n');

  } catch (error) {
    console.error('\n❌ Failed to initialize AI Workflow System:');
    console.error(error);
    console.error('\nThe server will continue, but AI workflows may not function properly.\n');
  }
});
