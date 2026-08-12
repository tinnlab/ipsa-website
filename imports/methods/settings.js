import _ from 'lodash';
import React from 'react';
import Text from 'antd/lib/typography/Text';
import Space from 'antd/lib/space';

const methods = {
    ora: {
        name: "ORA",
        description: (
            <Space direction="vertical">
                <Text strong>Over Representation Analysis</Text>
                Used limma for the Statistical test.
            </Space>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: true,
                mutable: true,
                visible: true,
            },
            test: {
                name: "Statistical test",
                options: ["limma", "t-test"],
                value: "limma",
                type: String,
                mutable: true,
                visible: false,
                description: "Statistical test used to identify differential expressed genes."
            },
            // maxDEGene: {
            //     name: "Max DE Genes",
            //     type: Number,
            //     parse: (e) => Math.round(e),
            //     value: 1000,
            //     mutable: true,
            //     min: 50,
            //     max: Infinity,
            //     visible: true,
            //     description: "Maximum number of differential expression genes used in the analysis."
            // },
            minDEGene: {
                name: "Min DE Genes",
                type: Number,
                parse: (e) => Math.round(e),
                value: 3,
                mutable: true,
                min: 1,
                max: Infinity,
                visible: true,
                description: "Min number of differential expression genes used in the analysis."
            },
            pThreshold: {
                name: "pValue.FDR ≤",
                type: Number,
                value: 0.05,
                mutable: true,
                min: 0,
                max: 1,
                visible: true,
                description: "The threshold of maximum adjusted p-value used to filter genes for the analysis. Genes with adjusted p-values bigger than this value will be excluded from the analysis."
            },
            fcThreshold: {
                name: "Absolute Log2FC ≥",
                type: Number,
                parse: (e) => e,
                value: 0.5,
                mutable: true,
                min: 0,
                max: 10,
                visible: true,
                description: "The threshold of minimum absolute fold change used to filter genes for the analysis. Genes with absolute fold change less than this value will be excluded from the analysis."
            }
        }
    },
    wilcox: {
        name: "Wilcox Test",
        description: (
            <Text strong>Wilcoxon signed-rank test</Text>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: true,
                mutable: true,
                visible: true
            }
        }
    },
    ks: {
        name: "KS Test",
        description: (
            <Text strong>Kolmogorov-Smirnov test</Text>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: true,
                mutable: true,
                visible: true
            }
        }
    },
    gsa: {
        name: "GSA",
        description: (
            <Space direction="vertical">
                <Text strong>Gene Set Analysis</Text>
                <Text>Website: <a>http://statweb.stanford.edu/~tibs/GSA/</a></Text>
                <Text>Manual: <a>https://cran.r-project.org/web/packages/GSA/GSA.pdf</a></Text>
            </Space>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: false,
                mutable: true,
                visible: true
            },
            permutation: {
                name: "Permutation",
                type: Number,
                parse: (e) => Math.round(e),
                value: 1000,
                mutable: true,
                min: 200,
                max: 10000,
                visible: true,
                description: "The number of permutation to perform when generating null distribution."
            },
            method: {
                name: "Method",
                value: "maxmean",
                options: ["maxmean", "mean", "absmean"],
                mutable: true,
                visible: true,
                description: "Method for summarizing gene-sets."
            },
            respType: {
                name: "Response type",
                value: "Two class unpaired",
                options: ["Two class unpaired"],
                mutable: false,
                visible: false,
                description: `Problem type. Only "Two class unpaired" is supported.`
            },
            randomSeed: {
                name: "Random seed",
                type: Number,
                parse: (e) => Math.round(e),
                value: 1,
                mutable: true,
                min: 0,
                max: Infinity,
                visible: true,
                description: "Seed for reproducibility."
            },
            knnNeighbors: {
                name: "KNN neighbors",
                type: Number,
                parse: (e) => Math.round(e),
                value: 10,
                mutable: true,
                min: 5,
                max: 20,
                visible: true,
                description: "Number of nearest neighbors to use for imputation of missing features values."
            },
            minSize: {
                name: "Minimum size",
                type: Number,
                parse: (e) => Math.round(e),
                value: 15,
                mutable: true,
                min: 5,
                max: 100,
                visible: true,
                description: "Minimum size of a gene-set to be consider in the analysis."
            },
            maxSize: {
                name: "Maximum size",
                type: Number,
                parse: (e) => Math.round(e),
                value: 500,
                mutable: true,
                min: 50,
                max: 500,
                visible: true,
                description: "Maximum size of a gene-set to be consider in the analysis."
            },
            restand: {
                name: "Restand",
                type: Boolean,
                value: true,
                mutable: false,
                visible: false,
                description: "Whether to use Restand's method for gene-set enrichment."
            },
            restandBasis: {
                name: "Restand basis",
                value: "catalog",
                options: ["catalog"],
                mutable: false,
                visible: false,
                description: "What should be used to do the restandardization? Only the set of genes in the genesets (catalog) is supported."
            },
        }
    },
    // gsea: {
    //     name: "GSEA",
    //     description: (
    //         <Space direction="vertical">
    //             <Text strong>Gene Set Enrichment Analysis</Text>
    //             <Text>Website: <a>http://www.gsea-msigdb.org/</a></Text>
    //         </Space>
    //     ),
    //     parameters: {
    //         enabled: {
    //             name: "Enabled",
    //             type: Boolean,
    //             value: false,
    //             mutable: true,
    //             visible: true
    //         },
    //         permutation: {
    //             name: "Permutation",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 1000,
    //             mutable: true,
    //             min: 200,
    //             max: 1000,
    //             visible: true,
    //             description: "The number of permutation to perform when generating null distribution."
    //         },
    //         randomSeed: {
    //             name: "Random seed",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 1,
    //             mutable: true,
    //             min: 0,
    //             max: Infinity,
    //             visible: true,
    //             description: "Seed for reproducibility."
    //         },
    //         permutationType: {
    //             name: "Permutation type",
    //             type: Number,
    //             value: 1,
    //             mutable: true,
    //             options: [0, 1],
    //             visible: true,
    //             description: "0 = unbalanced, 1 = balanced. Whether to balance the numbers of samples (choose the similar numbers of samples) of different conditions during the permutation process. "
    //         },
    //         minSize: {
    //             name: "Minimum size",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 15,
    //             mutable: true,
    //             min: 5,
    //             max: 100,
    //             visible: true,
    //             description: "Minimum size of a gene-set to be consider in the analysis."
    //         },
    //         maxSize: {
    //             name: "Maximum size",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 500,
    //             mutable: true,
    //             min: 50,
    //             max: 500,
    //             visible: true,
    //             description: "Maximum size of a gene-set to be consider in the analysis."
    //         },
    //         subsamplingFraction: {
    //             name: "Subsampling fraction",
    //             type: Number,
    //             value: 1.0,
    //             mutable: true,
    //             min: 0,
    //             max: 10.0,
    //             visible: true,
    //             description: "Subsampling fraction."
    //         }
    //     }
    // },
    fgsea: {
        name: "FGSEA",
        description: (
            <Space direction="vertical">
                <Text strong>Fast Gene Set Enrichment Analysis</Text>
                <Text>Website: <a>http://bioconductor.org/packages/release/bioc/html/fgsea.html</a></Text>
                <Text>Manual: <a>http://bioconductor.org/packages/release/bioc/manuals/fgsea/man/fgsea.pdf </a></Text>
            </Space>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: false,
                mutable: true,
                visible: true
            },
            permutation: {
                name: "Permutation",
                type: Number,
                parse: (e) => Math.round(e),
                value: 10000,
                mutable: true,
                min: 200,
                max: 100000,
                visible: true,
                description: "The number of permutation to perform when generating null distribution."
            },
            randomSeed: {
                name: "Random seed",
                type: Number,
                parse: (e) => Math.round(e),
                value: 1,
                mutable: true,
                min: 0,
                max: Infinity,
                visible: true,
                description: "Seed for reproducibility."
            },
            minSize: {
                name: "Minimum size",
                type: Number,
                parse: (e) => Math.round(e),
                value: 15,
                mutable: true,
                min: 5,
                max: 100,
                visible: true,
                description: "Minimum size of a gene-set to be consider in the analysis."
            },
            maxSize: {
                name: "Maximum size",
                type: Number,
                parse: (e) => Math.round(e),
                value: 500,
                mutable: true,
                min: 50,
                max: 1000,
                visible: true,
                description: "Maximum size of a gene-set to be consider in the analysis."
            }
        }
    },
    padog: {
        name: "PADOG",
        description: (
            <Space direction="vertical">
                <Text strong>Pathway Analysis with Down-weighting of Overlapping Genes</Text>
                <Text>Website: <a>https://bioconductor.org/packages/release/bioc/html/PADOG.html</a></Text>
                <Text>Manual: <a>https://bioconductor.org/packages/release/bioc/manuals/PADOG/man/PADOG.pdf</a></Text>
            </Space>
        )
        ,
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: false,
                mutable: true,
                visible: true
            },
            permutation: {
                name: "Permutation",
                type: Number,
                parse: (e) => Math.round(e),
                value: 1000,
                mutable: true,
                min: 200,
                max: 10000,
                visible: true,
                description: "Number of iterations to determine the gene set score significance p-values in PADOG method."
            },
            randomSeed: {
                name: "Random seed",
                type: Number,
                parse: (e) => Math.round(e),
                value: 1,
                mutable: true,
                min: 0,
                max: Infinity,
                visible: true,
                description: "Seed for reproducibility."
            },
        }
    },
    consensus: {
        name: "Consensus",
        description: (
            <Space direction={'vertical'}>
                <Text strong>Consensus Analysis</Text>
                Performs a consensus analysis on the results of selected methods. There are two algorithms available: Robust Rank Aggregation (RRA) and Weighted Z-Score Mean (weightedZMean).
            </Space>
        ),
        parameters: {
            enabled: {
                name: "Enabled",
                type: Boolean,
                value: false,
                mutable: true,
                visible: true
            },
            methods: {
                name: "Methods",
                type: Array,
                value: [],
                options: ["ora", "ks", "wilcox", "gsa", "gsea", "fgsea", "padog"],
                mutable: true,
                visible: true,
                description: "List of methods to use for the consensus pathway analysis."
            },
            consensus_method: {
                name: "Consensus Algorithm",
                value: "RRA",
                options: ["RRA", "weightedZMean"],
                optionLabels: {RRA: "Robust Rank Aggregation", weightedZMean: "Weighted Z-Score Mean"},
                mutable: true,
                visible: true,
                description: "Algorithm for Consensus."
            },
            rankBy: {
                name: "RRA Ranking",
                value: "pFDR",
                options: ["pFDR", "normalizedScore"],
                optionLabels: {pFDR: "pValue.FDR", normalizedScore: "Score"},
                mutable: true,
                visible: true,
                description: "How RRA ranks each method's pathways before aggregation. Used only when the Consensus Algorithm is RRA."
            },
        }
    }
    // pe: {
    //     name: "Impact Analysis",
    //     description: (
    //         <Space direction="vertical">
    //             <Text strong>Impact Analysis from R Onto-Tools suite</Text>
    //             <Text>Website: <a>https://www.bioconductor.org/packages/release/bioc/html/ROntoTools.html</a></Text>
    //             <Text>Manual: <a>https://www.bioconductor.org/packages/release/bioc/manuals/ROntoTools/man/ROntoTools.pdf </a></Text>
    //         </Space>
    //     )
    //     ,
    //     parameters: {
    //         enabled: {
    //             name: "Enabled",
    //             type: Boolean,
    //             value: false,
    //             mutable: true,
    //             visible: true
    //         },
    //         permutation: {
    //             name: "Number of bootstrap",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 1000,
    //             mutable: true,
    //             min: 200,
    //             max: 1000,
    //             visible: true,
    //             description: "Number of bootstrap iterations."
    //         },
    //         randomSeed: {
    //             name: "Random seed",
    //             type: Number,
    //             parse: (e) => Math.round(e),
    //             value: 1,
    //             mutable: true,
    //             min: 0,
    //             max: Infinity,
    //             visible: true,
    //             description: "Seed for reproducibility."
    //         }
    //     }
    // }
};

const x = {
    getAll: () => {
        return _.cloneDeep(methods)
    },
    getNames: () => {
        return {
            bacpa: 'CPA',
            ora: 'ORA',
            ks: 'KS',
            wilcox: 'Wilcox',
            gsa: 'GSA',
            gsea: 'GSEA',
            pe: 'Impact Analysis',
            padog: 'PADOG',
            fgsea: 'FGSEA'
        }
    },
    getDefaultSettings: () => {
        return Object.keys(methods).map(method => {
            return {
                method,
                params: Object.keys(methods[method].parameters).map(param => ({
                    param, value: methods[method].parameters[param].value
                })).reduce((p, c) => {
                    p[c.param] = c.value;
                    return p;
                }, {})
            }
        }).reduce((p, c) => {
            p[c.method] = c.params;
            return p;
        }, {});
    },
    getMethodName: (method) => {
        return methods[method].name
    },
    getParamName: (method, param) => {
        return methods[method]["parameters"][param].name
    },
    validate: (settings) => {
        Object.keys(methods).forEach(method => {
            Object.keys(methods[method].parameters).forEach(param => {
                if (!settings[method]) return;

                let p = settings[method][param];
                let _p = methods[method].parameters[param];

                // An absent value means "use default" (e.g. a config saved before
                // this param existed); skip it so adding a new optional param
                // (like rankBy) can't retro-break validation of old stored configs.
                if (p === undefined) return;

                if (!_p.mutable && p !== _p.value) {
                    throw new Error(`Parameter "${param}" of method "${method}" is immutable`);
                }

                if (_p.type !== undefined && _p.type !== typeof p) {
                    throw new Error(`Parameter "${param}" of method "${method}" should be a ${_p.type}`);
                }

                if (_p.options !== undefined && _p.options.indexOf(p) === -1) {
                    throw new Error(`Parameter "${param}" of method "${method}" should be one of ${JSON.stringify(_p.options)}`);
                }

                if (_p.min !== undefined && p < _p.min) {
                    throw new Error(`Parameter "${param}" of method "${method}" should > ${_p.min}`);
                }

                if (_p.max !== undefined && p > _p.max) {
                    throw new Error(`Parameter "${param}" of method "${method}" should < ${_p.max}`);
                }

                if (_p.parse) settings[method][param] = _p.parse(p);
            })
        });

        return settings;
    }
}

function getSupportedMethods(inputType) {
    return inputType === "ora" ?
        {ora: methods.ora} : (inputType === "pgsea") ? {
            wilcox: methods.wilcox, ks: methods.ks, fgsea: methods.fgsea, consensus: methods.consensus
        } : methods
}

function getDefaultSettingParams() {
    return x.getDefaultSettings()
}

function getMethodName(method) {
    return x.getMethodName(method)
}

function getParamName(method, param) {
    return x.getParamName(method, param)
}

// Friendly display label for an enum option value of a parameter, falling back
// to the raw value. Scoped per-parameter via its `optionLabels` map so labels
// never leak across unrelated params (unlike a value-keyed global lookup).
function getOptionLabel(method, param, value) {
    const def = methods[method] && methods[method].parameters[param]
    return (def && def.optionLabels && def.optionLabels[value]) ?? value
}

const supportedChart = {
    volcano: {
        name: "Volcano plot",
        description: "Volcano plot is a type of scatter-plot that shows statistical significance (adjusted p-value) versus magnitude of change (fold change).",
        methods: {
            ora: ["ora", "expression"],
            ks: [],
            wilcox: [],
            fgsea: ["pgsea", "expression"],
            gsa: ["expression"],
            gsea: ["expression"],
            padog: ["expression"],
        }
    },
    forest: {
        name: "Forest plot",
        description: "Forest plot is a type of scatter-plot that shows statistical significance (adjusted p-value) versus magnitude of change (fold change).",
        methods: {
            ora: ["ora", "expression"],
            ks: [],
            wilcox: [],
            fgsea: ["pgsea", "expression"],
            gsa: ["expression"],
            gsea: ["expression"],
            padog: ["expression"],
        }
    }
}

function getSupportedInputType(chartType, method) {
    return supportedChart[chartType].methods[method]
}

export default {
    getSupportedMethods,
    getSupportedInputType,
    getDefaultSettingParams,
    getMethodName,
    getParamName,
    getOptionLabel
}
