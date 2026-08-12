import * as echarts from 'echarts/lib/echarts'

export default echarts.SeriesModel.extend({
  type: 'series.scatterGL',

  dependencies: ['grid', 'polar', 'geo', 'singleAxis'],

  visualStyleAccessPath: 'itemStyle',

  hasSymbolVisual: true,

  getInitialData: function () {
    return echarts.helper.createList(this)
  },

  brushSelector: function (dataIndex, data, selectors) {
    let points = data._layout.points
    let offset = dataIndex * 2
    return selectors.point([points[offset], points[offset + 1]])
  },

  defaultOption: {
    coordinateSystem: 'cartesian2d',
    zlevel: 10,

    progressive: 1e5,
    progressiveThreshold: 1e5,

    // Cartesian coordinate system
    // xAxisIndex: 0,
    // yAxisIndex: 0,

    // Polar coordinate system
    // polarIndex: 0,

    // Geo coordinate system
    // geoIndex: 0,

    large: false,

    symbol: 'circle',
    symbolSize: 10,

    // symbolSize scale when zooming.
    zoomScale: 0,

    // Support source-over, lighter
    blendMode: 'source-over',

    itemStyle: {
      opacity: 1,
    },

    postEffect: {
      enable: false,
      colorCorrection: {
        exposure: 0,
        brightness: 0,
        contrast: 1,
        saturation: 1,
        enable: true,
      },
    },
  },
})