// Workflow engine to execute steps sequentially
import { Step01_Summary } from './steps/Step01_Summary.js';
import { Step02_GroupThemes } from './steps/Step02_GroupThemes.js';
import { Step03_GeneAnalysis } from './steps/Step03_GeneAnalysis.js';
import { Step04_PathwayMechanisms } from './steps/Step04_PathwayMechanisms.js';
import { Step05_PathwayDirections } from './steps/Step05_PathwayDirections.js';
import { Step055_NovelFindings } from './steps/Step055_NovelFindings.js';
import { Step06_MechanisticHypotheses } from './steps/Step06_MechanisticHypotheses.js';
import { Step07_TherapeuticImplications } from './steps/Step07_TherapeuticImplications.js';
import { Step08_FinalReport } from './steps/Step08_FinalReport.js';
import { WorkflowConfig } from './config.js';

export class StepWorkflowEngine {
  constructor(workflowId, userId) {
    this.workflowId = workflowId;
    this.userId = userId;

    // Initialize steps based on configuration
    this.steps = this._initializeSteps();

    this.context = {
      workflowId,
      userId,
      steps: {},
      startTime: new Date()
    };
  }

  _initializeSteps() {
    const allSteps = {
      1: new Step01_Summary(),
      2: new Step02_GroupThemes(),
      3: new Step03_GeneAnalysis(),
      4: new Step04_PathwayMechanisms(),
      5: new Step05_PathwayDirections(),
      5.5: new Step055_NovelFindings(),
      6: new Step06_MechanisticHypotheses(),
      7: new Step07_TherapeuticImplications(),
      8: new Step08_FinalReport()
    };

    // Get steps to run from config
    const stepsToRun = WorkflowConfig.workflow.stepsToRun;

    return stepsToRun.map(stepNum => allSteps[stepNum]).filter(s => s);
  }

  async execute(input) {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   PUBLICATION-READY WORKFLOW ENGINE   ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log(`Workflow ID: ${this.workflowId}`);
    console.log(`Steps to execute: ${this.steps.length}`);
    console.log(`Steps: ${this.steps.map(s => s.stepNumber).join(' → ')}\n`);

    // Validate input
    this._validateInput(input);

    try {
      for (const step of this.steps) {
        await this._executeStep(step, input);
      }

      this.context.endTime = new Date();
      this.context.duration = this.context.endTime - this.context.startTime;

      console.log('\n╔════════════════════════════════════════╗');
      console.log('║      WORKFLOW COMPLETED SUCCESSFULLY   ║');
      console.log('╚════════════════════════════════════════╝');
      console.log(`Duration: ${Math.round(this.context.duration / 1000)}s\n`);

      return {
        success: true,
        workflowId: this.workflowId,
        steps: this.context.steps,
        duration: this.context.duration,
        completedAt: this.context.endTime
      };

    } catch (error) {
      console.error('\n╔════════════════════════════════════════╗');
      console.error('║        WORKFLOW FAILED                 ║');
      console.error('╚════════════════════════════════════════╝');
      console.error(`Error: ${error.message}\n`);

      this.context.error = error.message;
      this.context.failedAt = new Date();

      throw error;
    }
  }

  async _executeStep(step, input) {
    // Check dependencies
    for (const depNum of step.getDependencies()) {
      if (!this.context.steps[depNum]) {
        throw new Error(
          `Step ${step.stepNumber} requires Step ${depNum}, but it hasn't been executed`
        );
      }

      // Check if dependency succeeded
      if (this.context.steps[depNum].error) {
        throw new Error(
          `Step ${step.stepNumber} cannot run because Step ${depNum} failed`
        );
      }
    }

    // Execute step
    const startTime = Date.now();

    try {
      console.log(`\n${'='.repeat(50)}`);
      const output = await step.execute(input, this.context);
      const duration = Date.now() - startTime;

      // Store result
      this.context.steps[step.stepNumber] = {
        stepNumber: step.stepNumber,
        stepName: step.stepName,
        output,
        duration,
        completedAt: new Date(),
        error: null
      };

      console.log(`✓ Step ${step.stepNumber} completed in ${Math.round(duration / 1000)}s`);

      // Save to database if configured
      if (WorkflowConfig.workflow.saveIntermediateResults) {
        await this._saveStepResult(step.stepNumber, output, duration);
      }

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`✗ Step ${step.stepNumber} failed:`, error.message);

      // Store error
      this.context.steps[step.stepNumber] = {
        stepNumber: step.stepNumber,
        stepName: step.stepName,
        output: null,
        duration,
        completedAt: new Date(),
        error: error.message
      };

      // Save error to database
      if (WorkflowConfig.workflow.saveIntermediateResults) {
        await this._saveStepResult(step.stepNumber, null, duration, error.message);
      }

      throw error;
    }
  }

  async _saveStepResult(stepNumber, output, duration, error = null) {
    try {
      await DBCollections.WorkflowSteps.insertAsync({
        workflowId: this.workflowId,
        userId: this.userId,
        stepNumber,
        output,
        duration,
        error,
        createdAt: new Date()
      });
    } catch (dbError) {
      console.warn(`Failed to save step ${stepNumber} to database:`, dbError.message);
    }
  }

  _validateInput(input) {
    if (!input) {
      throw new Error('Input is required');
    }

    if (!input.pathways || !Array.isArray(input.pathways)) {
      throw new Error('Input must contain pathways array');
    }

    if (!input.genes || !Array.isArray(input.genes)) {
      throw new Error('Input must contain genes array');
    }

    if (input.pathways.length === 0) {
      throw new Error('At least one pathway is required');
    }

    if (input.genes.length === 0) {
      throw new Error('At least one gene is required');
    }

    console.log('✓ Input validation passed');

    // Programmatic quality checks (replacing Step 1)
    if (input.pathways.length < 5) {
      console.warn(`⚠️ Warning: Low pathway count (${input.pathways.length}). Recommend ≥5 for robust analysis.`);
    }

    if (input.genes.length < 10) {
      console.warn(`⚠️ Warning: Low gene count (${input.genes.length}). Recommend ≥10 for robust analysis.`);
    }

    // Check for statistical significance data
    const pathwaysWithPValues = input.pathways.filter(p => p.pValue !== undefined && p.pValue !== null);
    if (pathwaysWithPValues.length < input.pathways.length) {
      console.warn(`⚠️ Warning: ${input.pathways.length - pathwaysWithPValues.length} pathways missing p-values.`);
    }

    const genesWithFC = input.genes.filter(g => g.foldChange !== undefined && g.foldChange !== null);
    if (genesWithFC.length < input.genes.length) {
      console.warn(`⚠️ Warning: ${input.genes.length - genesWithFC.length} genes missing fold change data.`);
    }
  }

  getStepOutput(stepNumber) {
    return this.context.steps[stepNumber]?.output || null;
  }

  getContext() {
    return this.context;
  }
}
