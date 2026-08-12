/**
 * Build the ECharts option object for the DE volcano plot.
 *
 * Pure function (no imports / side effects) so it can be reused by both the
 * Step 5 results view and the Step 2 "View Volcano Plot" preview modal, and be
 * unit-tested directly.
 *
 * @param {Array<{FC:number, pValue:number, name:string}>} volcanoData - DE rows;
 *        `pValue` here is the FDR-adjusted p-value.
 * @param {{maxAdjustedPValue:number, minLogFoldChange:number}} deSettings - thresholds.
 * @returns {object} ECharts option object (empty object when no data).
 */
export const getVolcanoOptions = (volcanoData, deSettings = {}) => {
    if (!volcanoData) return {};
    const pThreshold = deSettings.maxAdjustedPValue;
    const fcThreshold = deSettings.minLogFoldChange;

    return {
        xAxis: {
            type: 'value',
            name: 'Log2FC',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
            nameLocation: 'middle',
            nameGap: 30,
        },
        yAxis: {
            type: 'value',
            name: '-log10(pValue.FDR)',
            nameTextStyle: {
                fontSize: 12,
                fontWeight: 'bold',
            },
        },
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                return `<div style="font-size: 18px; margin-bottom: 7px">` +
                    '<div style="font-size: 14px;">' + params.data.value[2] + '</div>' +
                    '</div>';
            },
            backgroundColor: 'rgba(255,255,255,0.85)',
        },
        series: [
            {
                type: 'scatterGL',
                data: volcanoData.map(gene => ({
                    value: [
                        gene.FC,
                        gene.pValue >= 1e-16 ? -Math.log10(gene.pValue) : -Math.log10(1e-16),
                        `Gene name: ${gene.name}<br>pValue.FDR: ${gene.pValue?.toFixed(2)}<br>Log2FC: ${gene.FC?.toFixed(2)}`,
                        gene.pValue <= pThreshold && gene.FC >= fcThreshold ? 'Up-regulated' : (gene.pValue <= pThreshold && gene.FC <= -fcThreshold ? 'Down-regulated' : 'Non-significant'),
                        gene.pValue <= pThreshold && gene.FC >= fcThreshold ? 0 : (gene.pValue <= pThreshold && gene.FC <= -fcThreshold ? 1 : 2)
                    ]
                })),
                itemStyle: {
                    color: (params) => {
                        const data = params.data;
                        if (data.value[3] === 'Up-regulated') {
                            return '#FF0000'; // red for upregulated
                        } else if (data.value[3] === 'Down-regulated') {
                            return '#1312FF'; // blue for downregulated
                        } else {
                            return '#AAAAAA'; // grey for non-significant
                        }
                    },
                    opacity: 0.6
                },
                symbolSize: 5,
            }
        ],
        grid: {
            left: 60,
            right: 40,
            bottom: 60,
            top: 40
        }
    };
};
