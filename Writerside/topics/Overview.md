# Overview

**IPSA** (**Intelligent Platform for Systems-level Analysis**) is an advanced web application designed for comprehensive genomic data analysis and visualization.

The application's strength lies in its extensive visualization capabilities, providing a variety of charts for both single and meta-analyses at gene and pathway levels.
IPSA also leverages AI technology to interpret gene set enrichment analysis results using a Large Language Model (LLM), offering users deeper insights into their data.

## Key Features

1. **Differential Expression Analysis**: IPSA integrates established method for identifying genes that are differentially expressed between experimental conditions.
``
2. **Pathway Analysis**: The application integrates multiple methods for gene set enrichment analysis, including ORA, GSA, GSEA, FGSEA, KS, WS, and PADOG. This variety allows researchers to select the most appropriate method for their specific data and research questions.

3. **Multiple Databases**: IPSA integrates several widely-used biological databases (KEGG, GO, Reactome, MitoCarta) to provide comprehensive pathway information.

4. **Extensive Visualization** The application offers a wide range of visualization tools for both single and meta-analyses, at both gene and pathway levels. This includes popular chart types like gene and pathway volcano plots, Circos charts, bar charts, gene and pathway heatmaps, KEGG pathway map and pathway network.

5. **AI-Powered Interpretation**: By incorporating a Large Language Model (LLM), IPSA can provide AI-assisted interpretation of gene set enrichment analysis results, making complex data more accessible to researchers.

6. **Result Sharing**: IPSA facilitates collaboration by allowing users to share their results and visualizations.

## Glossary

Differential Expression Analysis
: A statistical method used to identify genes whose expression levels significantly differ between two or more groups of samples.

ORA (Over-Representation Analysis)
: A statistical method that determines whether certain gene sets are over-represented (enriched) in a list of genes of interest.

GSA (Gene Set Analysis)
: A statistical method that evaluates the significance of predefined sets of genes in relation to a specific outcome variable.
: [Manual](https://cran.r-project.org/web/packages/GSA/GSA.pdf)

GSEA (Gene Set Enrichment Analysis)
: An analytical approach that evaluates whether a predetermined group of genes exhibits consistent, statistically meaningful differences across two distinct biological conditions.
: [Website](https://www.gsea-msigdb.org/gsea/index.jsp)

FGSEA (Fast Gene Set Enrichment Analysis)
: An optimized algorithm for gene set enrichment analysis that is particularly efficient for large datasets.
: [Website](https://bioconductor.org/packages/release/bioc/html/fgsea.html), [Manual](http://bioconductor.org/packages/release/bioc/manuals/fgsea/man/fgsea.pdf)

KS (Kolmogorov-Smirnov Test)
: A non-parametric statistical test used in gene set analysis to determine whether the distribution of genes in a predefined set differs significantly from the background distribution. In pathway analysis, it's often used to assess the enrichment of gene sets without making assumptions about the underlying distribution of the data.

Wilcox (Wilcoxon Test)
: This is another non-parametric test used in gene set analysis. It compares the ranks of genes in a predefined set to those in the background, making it useful for identifying pathways where genes tend to have higher or lower ranks than expected by chance.

PADOG (Pathway Analysis with Down-weighting of Overlapping Genes)
: An advanced method for gene set analysis that addresses the issue of overlapping genes between pathways. PADOG down-weights the importance of genes that appear in multiple pathways, thereby reducing false positive results and providing a more accurate assessment of pathway significance.
: [Website](https://bioconductor.org/packages/release/bioc/html/PADOG.html), [Manual](https://bioconductor.org/packages/release/bioc/manuals/PADOG/man/PADOG.pdf)

KEGG (Kyoto Encyclopedia of Genes and Genomes)
: A database resource for understanding high-level functions and utilities of biological systems.

GO (Gene Ontology)
: A major bioinformatics initiative to unify the representation of gene and gene product attributes across all species.

Reactome
: An open-source, curated and peer-reviewed pathway database.

MitoCarta
: A comprehensive inventory of human and mouse genes encoding proteins with strong evidence of mitochondrial localization. MitoCarta3.0, released in 2020, catalogs 1136 human and 1140 mouse genes, providing annotations for sub-mitochondrial compartments and pathways.

Volcano Plot
: A type of scatter plot used to quickly identify changes in large datasets composed of replicate data.

Circos Diagram
: A circular visualization method used in IPSA to display relationships between differentially expressed genes and biological pathways. This powerful visualization tool allows researchers to see complex interactions and associations between genes and their related pathways in a compact, informative circular layout.

Forest Chart
: A graphical display designed to illustrate the relative strength of treatment effects in multiple quantitative scientific studies.

Heatmap
: A graphical representation of data where values are depicted by color.

KEGG Map
: A graphical representation of molecular pathways from the KEGG database.

Pathway Network
: A visual representation of the interconnections between multiple biological pathways. In IPSA, pathway networks are used to display how different pathways relate to each other based on shared genes.

LLM (Large Language Model)
: An artificial intelligence model trained on vast amounts of text data, capable of understanding and generating human-like text.
