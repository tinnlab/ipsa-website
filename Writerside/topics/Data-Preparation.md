# Data Preparation

**IPSA supports three different inputs, each input supports analysis with different methods:**
- Gene list: Over-representation analysis (ORA)
- Gene list and fold change: Kolmogorov-Smirnov test (KS Test), Wilcoxon signed-rank test (Wilcox Test), Fast Pre-ranked Gene Set Enrichment Analysis (FGSEA)
- Expression data matrix: ORA, KS test, Wilcox test, FGSEA, GSA (Geneset Analysis), Gene Set Enrichment Analysis (GSEA), Pathway Analysis with Down-weighting of Overlapping Genes (PADOG)

### Gene list {collapsible="true" default-state="expanded"}
Input gene list must be stored in a `.txt` file with each gene on a separate line.
line. The Gene ID can be EntrezID, KEGG ID, Gene Symbol, etc.

Below are examples with GeneID (EntreID), Gene Symbol, KEGG ID, and Affymetrix hgu133plus2 probe.

<table style="none">
<tr>
<td>

```
6534
6502
28231
54469
3958
55283
50485
10402
10428
26
```

</td>
<td>

```
LRRC47
LZTS2
MAD2L1
MAP1B
MAP2
MAP2K3
MAP2K4
MAP2K7
MAPK9
MARK4
```

</td>
<td>

```
hsa:1720
hsa:989
hsa:3608
hsa:4720
hsa:6439
hsa:5897
hsa:9480
hsa:1164
hsa:6229
hsa:8487
```

</td>
<td>

```
1552256_a_at
1552257_a_at
1552258_at
1552261_at
1552263_at
1552264_a_at
1552266_at
1552269_at
1552271_at
1552272_a_at 
```

</td>
</tr>
</table>


### Gene list and fold change {collapsible="true" default-state="expanded"}
Input gene list must be stored in a `.txt` or `.tsv`
file with each gene and its fold change on each line separated by a `tab` character.
Gene ID can be EntrezID, KEGG ID, Gene Symbol, etc. To see all supported ID Types, please visit
the Data source page.

Below are examples with GeneID (EntreID), Gene Symbol, KEGG ID, and Affymetrix hgu133plus2 probe.
<table style="none">
<tr>
<td>

```
23020   -0.022104449
55644   -0.023851675
55072   -0.020101857
2563    0.029127045
22976   0.018797544
2300    0.023799038
10936   -0.029220944
2963    0.014374435
23127   0.051962119
55423   0.03010304823020
```
</td>
<td>

```
ABHD4   0.220127184768263
ABHD5	0.615439683590562
ABHD6	1.50831660795693
ABHD8	-0.281072224128675
ABI1	0.426171730503105
ABI2	-0.260226045229052
ABL1	0.595988333627509
ABL2	-0.00671259418579993
ABLIM1	0.805408665490459
ABLIM2	2.44735717462544 
```
</td>
</tr>
<tr>
<td>

```
hsa:10625	-0.001011359
hsa:6795	0.000978679
hsa:64109	0.001007177
hsa:23051	0.000637776
hsa:79726	0.001316198
hsa:6503	0.000699499
hsa:55026	-0.00062984
hsa:114883	0.001487218
hsa:9310	0.000528979
hsa:10137	0.000463783 
```
</td>
<td>

```
1552311_a_at	-0.838394204314119
1552312_a_at	2.7864702280181
1552314_a_at	0.828274229038452
1552315_at	-0.025119056689585
1552316_a_at	-0.0591446125739281
1552318_at	1.19103929628282
1552319_a_at	-0.226665137288169
1552320_a_at	0.200855604759189
1552321_a_at	1.4071733409876
1552322_at	0.595988333627509
```
</td>
</tr>
</table>

### Expression data file {collapsible="true" default-state="expanded"}
Expression data can be **uploaded manually**. Data uploaded from local machines must follow our
format (see **Data format** tab).

Two files are required to perform pathway analysis: 1) Expression data file and 2) Group data file.
Both files are in `.csv` format.
- Gene expression data must be saved as a `.csv` file, in which rows indicate genes and columns indicate samples.
- The first row must be sample names and the first column must be genes id.
- Sample names should not contain special characters
- Gene ID can be EntrezID, KEGG ID, Gene Symbol, etc. To see all support ID types, please visit the Data source page.
- It is up to users to normalize expression data before uploading to the website.

Example below is an expression matrix with KEGG ID:

```
"","GSM21203","GSM21206","GSM21207","GSM21215","GSM21217","GSM21218"
"hsa:10",6.18613917271151,5.64502567098228,6.73324685452829,6.17996658966757,6.50537402264283,6.09164376091985
"hsa:100",6.43032504687542,5.79359967573988,6.63037835414765,6.01262616580018,6.24935089994504,5.9438166716528
"hsa:1000",7.56614063766587,8.27120014366728,7.85361733226786,7.76593559015308,7.8274078562957,7.74649475298197
"hsa:10000",8.527515688339,8.31085197640384,8.05190926233479,8.10895984615411,8.19694107154907,8.31956731386563
"hsa:100008586",4.76648431861781,4.58511764880759,5.13594085162142,4.87417176001213,4.61645421365085,4.55003201505522
"hsa:10001",4.79196585202759,4.91675543877265,4.4863946849729,4.67166475145703,4.71566723642853,5.04455411893207
"hsa:10002",4.61571716066639,4.25217930328034,5.00458346728788,4.54007171613674,4.45401539657362,4.48764759569785
"hsa:10003",3.86808984905074,3.8899102742205,4.02302238911423,4.10485504166507,4.09275831103573,4.07127375991903
```

#### Group Data
- Sample group data file is optional. However, a predefined sample group file will help selecting samples for analysis faster.
- If no group data file is uploaded, users are required to manually select samples for analysis.
- Group data file must be saved as a `.csv` file, in which each row indicates one sample and their groups.
- One sample can have multiple groups separated by `,`.

Example:

```
"GSM21203","condition"
"GSM21206","condition"
"GSM21207","condition"
"GSM21215","control"
"GSM21217","control"
"GSM21218","control"
```