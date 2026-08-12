import Input from "antd/lib/input";
import Space from "antd/lib/space";
import Button from "antd/lib/button";
import SearchOutlined from "@ant-design/icons/SearchOutlined";
import Highlighter from "react-highlight-words";
import React, {useState} from "react";
import _ from "lodash";

export default (dataIndex) => {

    const [searchState, setSearchState] = useState({
        searchText: '',
        searchedColumn: ''
    })

    const handleSearch = (selectedKeys, confirm, dataIndex) => {
        confirm();
        setSearchState({
            searchText: selectedKeys[0],
            searchedColumn: dataIndex
        });
    };

    const handleReset = clearFilters => {
        clearFilters();
        setSearchState({searchText: ''});
    };

    return ({
        filterDropdown: ({setSelectedKeys, selectedKeys, confirm, clearFilters}) => (
            <div style={{padding: 8}}>
                <Input
                    placeholder={`Keyword for search`}
                    value={selectedKeys[0]}
                    onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                    onPressEnter={() => handleSearch(selectedKeys, confirm, dataIndex)}
                    style={{marginBottom: 8, display: 'block'}}
                />
                <Space>
                    <Button
                        type="primary"
                        onClick={() => handleSearch(selectedKeys, confirm, dataIndex)}
                        icon={<SearchOutlined/>}
                        size="small"
                    >
                        Search
                    </Button>
                    <Button onClick={() => handleReset(clearFilters)} size="small">
                        Reset
                    </Button>
                    <Button
                        type="link"
                        size="small"
                        onClick={() => {
                            confirm({closeDropdown: false});
                            setSearchState({
                                searchText: selectedKeys[0],
                                searchedColumn: dataIndex,
                            });
                        }}
                    >
                        Filter
                    </Button>
                </Space>
            </div>
        ),
        filterIcon: filtered => <SearchOutlined style={{color: filtered ? '#1890ff' : undefined}}/>,
        onFilter: (value, record) =>
            _.get(record, dataIndex)
                ? _.get(record, dataIndex).toString().toLowerCase().includes(value.toLowerCase())
                : '',
        render: text => {
            return JSON.stringify(searchState.searchedColumn) === JSON.stringify(dataIndex) ? (
                <Highlighter
                    highlightStyle={{backgroundColor: '#ffc069', padding: 0}}
                    searchWords={[searchState.searchText]}
                    autoEscape
                    textToHighlight={text ? text.toString() : ''}
                />
            ) : (
                text
            )
        },
    });
}