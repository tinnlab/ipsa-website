INPUT DATA
DE Genes (Differentially Expressed Genes)
Gene_Symbol | Log2FC | P-value | Adj_P-value
MYC         | 3.2    | 1.2e-15 | 2.3e-14
CCND1       | 2.8    | 3.4e-12 | 4.5e-11
CDK4        | 2.1    | 5.6e-10 | 6.7e-9
E2F1        | 2.9    | 1.1e-13 | 1.8e-12
TP53        | -2.4   | 2.3e-14 | 3.1e-13
CDKN1A      | -1.8   | 4.5e-9  | 5.2e-8
BRCA1       | -2.1   | 6.7e-11 | 7.8e-10
FOXO3       | -1.9   | 8.9e-10 | 9.1e-9
BAX         | -1.7   | 3.4e-8  | 4.1e-7
CASP3       | -1.6   | 5.6e-8  | 6.3e-7
VEGFA       | 2.5    | 7.8e-11 | 8.9e-10
HIF1A       | 2.3    | 9.1e-10 | 1.0e-8
IL6         | 2.7    | 4.5e-12 | 5.6e-11
TNF         | 2.2    | 6.7e-10 | 7.8e-9
AKT1        | 2.4    | 8.9e-11 | 9.5e-10
MTOR        | 2.0    | 1.2e-9  | 1.4e-8
...
(Total: 847 DE genes)
Pathway Enrichment Analysis Results
Pathway_Name                          | P-value  | FDR      | Enrichment_Score | Genes_in_Pathway | DE_Genes_in_Pathway
Cell Cycle                            | 1.2e-18  | 3.4e-17  | 8.5              | 124              | 45
G1/S Transition                       | 3.4e-16  | 5.6e-15  | 7.8              | 87               | 38
E2F Transcription Factor Network      | 5.6e-15  | 7.8e-14  | 7.2              | 65               | 32
DNA Replication                       | 7.8e-14  | 9.1e-13  | 6.9              | 98               | 35
Mitotic Cell Cycle                    | 9.1e-13  | 1.0e-11  | 6.5              | 156              | 42
PI3K-AKT Signaling Pathway            | 1.2e-12  | 1.5e-11  | 6.3              | 354              | 67
p53 Signaling Pathway                 | 2.3e-11  | 2.8e-10  | 5.8              | 72               | 28
Apoptosis                             | 4.5e-10  | 5.2e-9   | 5.2              | 142              | 35
Intrinsic Apoptotic Pathway           | 6.7e-9   | 7.1e-8   | 4.8              | 54               | 22
HIF-1 Signaling Pathway               | 8.9e-9   | 9.5e-8   | 4.6              | 109              | 31
Angiogenesis                          | 1.1e-8   | 1.3e-7   | 4.4              | 78               | 26
VEGF Signaling Pathway                | 1.4e-8   | 1.6e-7   | 4.3              | 89               | 27
mTOR Signaling Pathway                | 1.8e-8   | 2.0e-7   | 4.1              | 156              | 38
Inflammatory Response                 | 2.3e-8   | 2.6e-7   | 4.0              | 234              | 48
DNA Damage Response                   | 3.1e-8   | 3.5e-7   | 3.9              | 125              | 32
BRCA1 DNA Damage Response             | 4.5e-7   | 5.1e-6   | 3.2              | 45               | 18
...
(Total: 67 significantly enriched pathways)
Gene-Pathway Mapping (Sample)
Cell Cycle: MYC, CCND1, CDK4, E2F1, TP53, RB1, CDKN1A, CDC25A...
PI3K-AKT Signaling: AKT1, MTOR, PIK3CA, PTEN, FOXO3, GSK3B, TSC2...
p53 Signaling: TP53, CDKN1A, BAX, CASP3, MDM2, PUMA, GADD45A...


WORKFLOW STEPS


Step 1: Data Understanding and Quality Check
LLM Task: Examine the data structure and identify potential issues

Check if expected number of pathways/genes are present
Identify if any pathways have very few genes
Flag if p-values or enrichment scores seem unusual
Verify data format and completeness

Prompt Example: "Analyze this pathway enrichment result. Are there any quality issues? Do the enrichment scores and p-values look reasonable?"
Step 2: Summarize Overall Results
LLM Task: Create high-level summary of findings

Identify how many pathways are significantly enriched
Determine dominant biological themes
Note whether results are up-regulated, down-regulated, or mixed
Provide a "big picture" interpretation

Prompt Example: "Summarize these pathway enrichment results. What are the main biological themes? How many pathways are enriched and what's the overall pattern?"
Step 3: Validate with Expected Themes (Context-Dependent)
LLM Task: Check for expected pathways given experimental context

Identify if known disease-relevant pathways appear
Flag missing expected pathways as potential issues
Validate that results make biological sense

Prompt Example: "This data is from a lung cancer study comparing tumor vs. normal tissue. Are the expected cancer-related pathways enriched? What's missing that should be there?"
Step 4: Group Pathways into Biological Themes
LLM Task: Organize redundant/related pathways into coherent themes

Identify overlapping or hierarchically related pathways
Create semantic groupings (e.g., all immune pathways together)
Suggest theme names for clusters
Reduce redundancy in pathway list

Prompt Example: "Group these enriched pathways into major biological themes. Which pathways are related or redundant?"
Step 5: Prioritize Pathways by Biological Relevance
LLM Task: Rank pathways beyond just statistical significance

Consider which pathways are most mechanistically important
Identify novel vs. well-studied pathways in this context
Highlight pathways with therapeutic potential
Consider which are most actionable

Prompt Example: "Rank these enriched pathways by biological importance for understanding disease mechanism, not just by p-value. Which should we investigate first?"
Step 6: Analyze Gene-Level Details
LLM Task: Deep dive into genes driving enrichment

Identify which DE genes appear in multiple enriched pathways (hub genes)
Find potential master regulators
Analyze fold-changes of key genes
Identify "leading edge" genes contributing most to enrichment
Flag genes with extreme expression changes

Prompt Example: "Which genes appear in multiple enriched pathways? Which genes have the most extreme fold changes? Identify potential hub genes or master regulators."
Step 7: Explain Pathway Mechanisms and Interactions
LLM Task: Interpret biological meaning and connections

Explain what each enriched pathway does biologically
Describe crosstalk between enriched pathways
Explain how pathways might work together
Identify upstream and downstream relationships
Connect to biological mechanisms

Prompt Example: "Explain the biological function of the top 5 enriched pathways and how they might interact with each other in this disease context."
Step 8: Compare Pathway Directions (Up vs. Down)
LLM Task: Analyze patterns in regulation direction

Separate pathways by whether they're activated vs. suppressed
Identify if certain themes are consistently up or down
Interpret what the direction means biologically

Prompt Example: "Looking at the fold changes of genes in each pathway, determine which pathways are activated vs. suppressed. What does this pattern tell us?"
Step 9: Literature Contextualization
LLM Task: Place findings in context of existing knowledge

Identify which findings are well-established vs. novel
Note if results confirm or contradict previous studies
Highlight unexpected findings
Suggest relevant literature (may need web search)

Prompt Example: "Which of these enriched pathways are well-known in this disease? Which findings are unexpected or novel?"
Step 10: Generate Mechanistic Hypotheses
LLM Task: Propose biological mechanisms explaining results

Create mechanistic models connecting pathways
Propose cause-effect relationships
Suggest why certain pathways are enriched
Generate testable hypotheses

Prompt Example: "Based on these enriched pathways and DE genes, propose a mechanistic model explaining how these pathways contribute to disease. What are 3 testable hypotheses?"
Step 11: Identify Therapeutic Implications
LLM Task: Find clinically actionable insights

Identify druggable targets in enriched pathways
Suggest existing drugs that might target these pathways
Highlight pathways with therapeutic potential
Note safety considerations

Prompt Example: "Which genes or pathways could be therapeutic targets? Are there existing drugs that target these pathways?"
Step 12: Suggest Validation Experiments
LLM Task: Design follow-up studies

Recommend specific experiments to validate key findings
Suggest which genes/pathways to validate first
Propose experimental approaches (qPCR, Western blot, functional assays)
Prioritize validation based on importance and feasibility

Prompt Example: "What experiments should we do to validate these top 5 pathways? Prioritize by importance and suggest specific assays."
Step 13: Generate Report/Documentation
LLM Task: Create comprehensive written output

Write methods section describing the analysis
Create results section summarizing findings
Generate tables of key pathways and genes
Draft discussion connecting to biology
Create figure legends

Prompt Example: "Write a results section for a scientific paper describing these pathway enrichment findings. Include a summary table of top pathways."
Key Advantages of LLM with Data Access:

Integration: Can connect DE gene data with pathway information to provide deeper insights
Gene-level analysis: Can identify hub genes and master regulators by analyzing which genes appear where
Mechanistic reasoning: Can explain WHY pathways are enriched based on gene expression patterns
Contextualization: Can interpret results based on experimental design and disease context
Prioritization: Can go beyond statistics to biological importance

The LLM essentially acts as an intelligent biological analyst that can interpret the data, not just describe it.