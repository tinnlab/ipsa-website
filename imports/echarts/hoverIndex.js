import KDBush from 'kdbush'
import _ from 'lodash'

export const indexDisplayList = _.debounce(storage => {
  const index = new KDBush(storage._displayList.length)
  storage._displayList.forEach(e => {
    index.add(e.x || 0, e.y || 0)
  })
  index.finish()
  storage._displayListIndex = index
}, 100)
