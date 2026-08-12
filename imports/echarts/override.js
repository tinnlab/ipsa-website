// import _ from 'lodash'
// import zRenderHandler from 'zrender/lib/Handler'
//
// const mouseMove = zRenderHandler.prototype.mousemove
// zRenderHandler.prototype.mousemove = _.debounce(mouseMove, 50)

// import SeriesData from 'echarts/lib/data/SeriesData'
// import DataStore from 'echarts/lib/data/DataStore'
// SeriesData.prototype.cloneShallow = function () {
//   return this
// }
//
// DataStore.prototype.clone = function () {
//   return this
// }

import Handler from 'zrender/lib/Handler'

function HoveredResult(x, y, target, topTarget) {
  this.x = x
  this.y = y
  this.target = target
  this.topTarget = topTarget
}

const _findHover = Handler.prototype.findHover

Handler.prototype.findHover = function (x, y) {
  let index = this.storage._displayListIndex
  if (!index) {
    return _findHover.call(this, x, y)
  }

  let found = new Set(index.range(x - 10, y - 10, x + 10, y + 10))
  if (found.size === 0) {
    return _findHover.call(this, x, y)
  }

  let list = this.storage.getDisplayList()
  let idx = Array.from(found)[0]
  return new HoveredResult(x, y, list[idx], list[idx])
}
