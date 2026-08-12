import React, { useState, useEffect } from "react";
import { ResizableBox } from 'react-resizable';
import ResizeDetector from 'react-resize-detector';
import Drawer from 'antd/lib/drawer';
import Button from "antd/lib/button";
import Tabs from "antd/lib/tabs";
import InputNumber from "antd/lib/input-number";
import Popover from "antd/lib/popover";
import Select from "antd/lib/select";
import Text from "antd/lib/typography/Text";
import EllipsisOutlined from "@ant-design/icons/lib/icons/EllipsisOutlined";
import _ from "lodash";
import Tree from "antd/lib/tree";


export default ({ props, data }) => {
    const [state, setState] = useState({
        bottomDrawerHeight: 300,
        showBottomDrawer: true,
        bottomDrawerWidth: 300
    });
    const [treeData, setTreeData] = useState([]);
    const [expandedKeys, setExpandedKeys] = useState([]);
    const [checkedKeys, setCheckedKeys] = useState([]);
    const [autoExpandParent, setAutoExpandParent] = useState(true);

    const [tableData, setTableData] = useState([]);

    const onExpand = (expandedKeysValue) => {
        setExpandedKeys(expandedKeysValue);
        setAutoExpandParent(false);
    };

    const onCheck = (checkedKeysValue) => {
        setCheckedKeys(checkedKeysValue);
    };

    const configDataSetting = () => {
        let selectedKeys = [];
        let tDat = Object.keys(data).map(key => {
            let dat = data[key];
            let children = Object.keys(dat.results).map(child => {
                let res = dat.results[child];
                let methods = _.uniq(res.result.map(e => e.key));
                const childData = methods.map(method => {
                    return {
                        title: method,
                        key: key + "-" + child + "-" + method
                    }
                })
                if (childData.length > 0) {
                    selectedKeys.push(childData[0].key);
                }
                return {
                    title: child,
                    key: key + "-" + child,
                    children: childData
                }
            });

            return {
                title: dat.name,
                key: key,
                children: children
            }
        })
        console.log({ tDat, selectedKeys });
        setTreeData(tDat);
        setCheckedKeys(selectedKeys);
        setExpandedKeys(selectedKeys);
    }

    const generateTableData = () => {
        console.log({ data })
        let tableData = Object.keys(data).map(key => {
            let dat = data[key];
            let children = Object.keys(dat.results).map(child => {
                let res = dat.results[child];
                let geneStatsMap = res.geneStats?.map(geneStat => {
                    return {
                        ...geneStat,
                        geneSets: _.keyBy(geneStat.geneSets, 'id')
                    }
                });
                geneStatsMap = _.keyBy(geneStatsMap, 'id');

                const resultMappedPathways = res.result?.map(result => {
                    return {
                        ...result,
                        geneSets: _.keyBy(result.value, 'pathway'),
                        value: null
                    }
                });
                let tDataObject = {};
                resultMappedPathways.forEach(result => {
                    if (!tDataObject[result.databaseId]) {
                        tDataObject[result.databaseId] = {
                            ...result,
                            geneSets: _.keyBy(Object.keys(result.geneSets).map(pathway => {
                                return {
                                    ...result.geneSets[pathway],
                                    [key + '-' + child + "-" + result.key + "-pValue"]: result.geneSets[pathway].pValue,
                                    [key + '-' + child + "-" + result.key + "-pValueFDR"]: result.geneSets[pathway].pValueFDR
                                }
                            }), 'pathway')
                        }
                    }
                    else {
                        tDataObject[result.databaseId] = {
                            ...tDataObject[result.databaseId],
                            geneSets: {
                                ...(_.keyBy(Object.keys(result.geneSets).map(pathway => {
                                    return {
                                        ...tDataObject[result.databaseId].geneSets[pathway],
                                        ...result.geneSets[pathway],
                                        [key + '-' + child + "-" + result.key + "-pValue"]: result.geneSets[pathway].pValue,
                                        [key + '-' + child + "-" + result.key + "-pValueFDR"]: result.geneSets[pathway].pValueFDR
                                    }
                                }), 'pathway'))
                            }
                        }
                    }
                });

                const tData = Object.keys(tDataObject).map(databaseId => {
                    let mappedGeneSets = geneStatsMap[databaseId]
                    if (mappedGeneSets) {
                        let geneSets = Object.keys(tDataObject[databaseId].geneSets).map(pathway => {
                            return {
                                ...tDataObject[databaseId].geneSets[pathway],
                                name: mappedGeneSets.geneSets[pathway].name,
                                genes: mappedGeneSets.geneSets[pathway].genes,
                                pValue: null,
                                pValueFDR: null,
                                databaseId,
                                databaseName: mappedGeneSets.name,
                                namespace: mappedGeneSets.namespace,
                                rowKey: databaseId + '-' + pathway
                            }
                        });
                        return geneSets
                    }
                }).flat();
                return _.keyBy(tData, 'rowKey');
            })
            let tDObject = {};
            children.forEach(child => {
                Object.keys(child).forEach(key => {
                    if (!tDObject[key]) {
                        tDObject[key] = child[key];
                    }
                    else {
                        tDObject[key] = {
                            ...tDObject[key],
                            ...child[key]
                        }
                    }
                })
            })
            console.log({ tDObject })
            return tDObject
        })
        console.log({ tableData });

        let tableDataObject = {};
        tableData.forEach(child => {
            Object.keys(child).forEach(key => {
                if (!tableDataObject[key]) {
                    tableDataObject[key] = child[key];
                }
                else {
                    tableDataObject[key] = {
                        ...tableDataObject[key],
                        ...child[key]
                    }
                }
            })
        })
        console.log(_.values(tableDataObject));
        setTableData(_.values(tableDataObject))
    }

    useEffect(() => {
        // configDataSetting();
        // generateTableData();
    }, [data]);

    console.log({ data, checkedKeys, expandedKeys, treeData });

    // useEffect(() => {
    //     let methodBasedColumns = Object.keys(methodSettings).filter(method => methodSettings[method].enabled).map(method => {
    //         return [
    //             {
    //                 title: method.toUpperCase() + " P-Value",
    //                 dataIndex: method + '_pValue', key: method + '_pValue',
    //                 sorter: (a, b) => a[method + '_pValue'] - b[method + '_pValue'],
    //                 render: (text, record) => {
    //                     if (text === null || text === undefined || text === '') {
    //                         return '-';
    //                     }
    //                     text = Number(text);
    //                     text = text.toExponential(3);
    //                     if (record[method + '_pValue'] <= highlightPValue) {
    //                         return <Text style={{
    //                             color: '#e74c3c',
    //                             fontWeight: 800
    //                         }} >{text}</Text>;
    //                     }
    //                     return text;
    //                 },
    //                 filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
    //                     let key = 'filterResPval-' + method + '_pValue';
    //                     return (
    //                         <div style={{
    //                             padding: 8,
    //                             display: "inline-block"
    //                         }}>
    //                             <Text
    //                                 style={{ margin: 10 }}>{'pValue ≤'}</Text>
    //                             <InputNumber style={{ width: 100 }}
    //                                 onChange={e => this[key] = e}
    //                                 min={0}
    //                                 max={1} />
    //                             <Button style={{
    //                                 width: 60,
    //                                 marginLeft: 10,
    //                                 padding: 3
    //                             }} onClick={() => {
    //                                 setSelectedKeys([this[key]]);
    //                                 confirm();
    //                             }}>Filter</Button>
    //                         </div>
    //                     )
    //                 },
    //                 onFilter: (value, record) => {
    //                     return record[method + '_pValue'] <= value;
    //                 },
    //                 width: 175
    //             },
    //             {
    //                 title: method.toUpperCase() + " P-Value FDR",
    //                 dataIndex: method + '_pValueFDR', key: method + '_pValueFDR',
    //                 sorter: (a, b) => a[method + '_pValueFDR'] - b[method + '_pValueFDR'],
    //                 render: (text, record) => {
    //                     if (text === null || text === undefined || text === '') {
    //                         return '-';
    //                     }
    //                     text = Number(text);
    //                     text = text.toExponential(3);
    //                     if (record[method + '_pValueFDR'] <= highlightPValueFDR) {
    //                         return <Text style={{
    //                             color: '#e74c3c',
    //                             fontWeight: 800
    //                         }} >{text}</Text>;
    //                     }
    //                     return text;
    //                 },
    //                 filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
    //                     let key = 'filterResPvalFDR-' + method + '_pValueFDR';
    //                     return (
    //                         <div style={{
    //                             padding: 8,
    //                             display: "inline-block"
    //                         }}>
    //                             <Text
    //                                 style={{ margin: 10 }}>{'pValue ≤'}</Text>
    //                             <InputNumber style={{ width: 100 }}
    //                                 onChange={e => this[key] = e}
    //                                 min={0}
    //                                 max={1} />
    //                             <Button style={{
    //                                 width: 60,
    //                                 marginLeft: 10,
    //                                 padding: 3
    //                             }} onClick={() => {
    //                                 setSelectedKeys([this[key]]);
    //                                 confirm();
    //                             }
    //                             }>Filter</Button>
    //                         </div>
    //                     )
    //                 },
    //                 onFilter: (value, record) => {
    //                     return record[method + '_pValueFDR'] <= value;
    //                 },
    //                 width: 175
    //             }
    //         ]
    //     }).flat();
    //     let cols = [
    //         {
    //             title: "ID", dataIndex: 'pathway', key: 'pathway', width: 150,
    //             fixed: 'left'
    //         },
    //         {
    //             title: "Database",
    //             render: (text, record) => {
    //                 return <Text>{record.databaseName + (record.namespace ? ' (' + record.namespace + ')' : '')}</Text>
    //             }
    //         },
    //         {
    //             title: "Name", dataIndex: 'name', key: 'name', width: 250,
    //             fixed: 'left'
    //         },
    //         {
    //             title: "#Genes", dataIndex: 'genes', key: 'genes',
    //             sorter: (a, b) => a.genes - b.genes,
    //             width: 100
    //         }
    //     ];

    // }, [checkedKeys]);


    return (
        <>
            <div className={"bottom-resizer-mask"} ref={(r) => this.bottomResizerMaskRef = r} />
            {
                <Drawer id={"bottom-drawer"} className={"bottom-drawer"}
                    placement="bottom"
                    height={state.bottomDrawerHeight}
                    style={{ height: state.showBottomDrawer ? state.bottomDrawerHeight : 'unset' }}
                    closable={true}
                    getContainer={false}
                    visible={state.showBottomDrawer}
                    mask={false}
                    onClose={() => {
                        setState({
                            ...state,
                            showBottomDrawer: false
                        })
                    }}>
                    <ResizableBox width={0} height={300} className={'resizable-box'} axis="y"
                        resizeHandles={['n']}
                        handle={<EllipsisOutlined className={'resize-handle-top'} />}
                        onResizeStop={(e, dat) => {
                            this._btmDrawerUpdateHeight = dat.size.height;
                            if (this._btmDrawerUpdateHeight !== undefined) {
                                let h = this._btmDrawerUpdateHeight;
                                this._btmDrawerUpdateHeight = undefined;
                                setState({
                                    ...state,
                                    bottomDrawerHeight: h
                                });
                            }

                            document.removeEventListener('mousemove', this.mouseMoveEventListener)
                            this.bottomResizerMaskRef.style.display = "none"
                        }}
                        onResizeStart={(e, dat) => {
                            this.mouseMoveEventListener = (e) => {
                                this.bottomResizerMaskRef.style.top = e.clientY + "px"
                                this.bottomResizerMaskRef.style.display = "block"
                            }
                            document.addEventListener('mousemove', this.mouseMoveEventListener);
                        }}
                    />
                    <ResizeDetector
                        handleWidth
                        onResize={(width) => {
                            setState({
                                ...state,
                                bottomDrawerWidth: width
                            })
                        }}
                    />
                    <Tabs type="card" style={{ display: state.showBottomDrawer ? undefined : 'none' }} className={"tab-pane"}>
                        <Tabs.TabPane tab="Data Setting" key='data-setting'>
                            <Tree
                                checkable
                                onExpand={onExpand}
                                expandedKeys={expandedKeys}
                                autoExpandParent={autoExpandParent}
                                onCheck={onCheck}
                                checkedKeys={checkedKeys}
                                treeData={treeData}
                            />
                        </Tabs.TabPane>
                        <Tabs.TabPane tab="Data" key="data">
                            <div className={'data-tab-wrapper'}>
                                <div className={'filter-result'}>
                                    <Text>Highlight:</Text>
                                    <Text style={{ margin: 10 }}>{'pValue ≤'}</Text>
                                    <Text style={{ margin: 10 }}>{'Show pvalue-FDR only'}</Text>
                                    <Popover
                                        content={(
                                            <div className={"hide-result-container"}>
                                                <div className={"row"}>
                                                    <Select mode="multiple"
                                                        style={{ width: 200, marginRight: 10 }}
                                                        placeholder="Select results to hide"

                                                        onChange={(values) => {
                                                            values = values.map(e => e.split('-')).reduce((p, c) => {
                                                                p[c[0]] = {
                                                                    [c[1]]: true,
                                                                    ...p[c[0]]
                                                                };
                                                                return p;
                                                            }, {});
                                                        }}
                                                    >
                                                    </Select>
                                                </div>
                                            </div>
                                        )}
                                        title={null}
                                        trigger="click"
                                    >
                                        <Button type={"primary"} style={{ marginLeft: 10 }}>
                                            Hide results
                                        </Button>
                                    </Popover>

                                    <Popover
                                        content={(
                                            <div className={"quick-selection-container"}>
                                                <div className={"row"}>
                                                    Select all pathway with
                                                    <Select style={{ marginLeft: 10 }} onChange={val => {

                                                    }}>
                                                        <Select.Option value={">="}>at least</Select.Option>
                                                        <Select.Option value={"="}>exact</Select.Option>
                                                    </Select>
                                                    <InputNumber onChange={val => {

                                                    }} />
                                                </div>
                                            </div>
                                        )}
                                        title={null}
                                        trigger="click"
                                    >
                                        <Button type={"primary"} style={{ marginLeft: 10 }}>
                                            Quick selection
                                        </Button>
                                    </Popover>
                                </div>
                                {/* <Table data={data} /> */}
                            </div>
                        </Tabs.TabPane>
                    </Tabs>
                </Drawer>
            }
        </>
    )
}