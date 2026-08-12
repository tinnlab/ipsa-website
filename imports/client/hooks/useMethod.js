import { useState, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'

export default function useMethod(methodName, args, deps) {
    const [state, setState] = useState({ isLoading: true, error: null, data: null })

    useEffect(() => {
        // Meteor.call(methodName, args, (err, result) => {
        //     if (err) {
        //         setState({
        //             isLoading: false, error: err, data: null
        //         })
        //     } else {
        //         setState({
        //             isLoading: false, error: null, data: result
        //         })
        //     }
        // })
        Meteor.callAsync(methodName, args).then(data => {
            setState({ isLoading: false, error: null, data })
        }).catch(error => {
            setState({ isLoading: false, error, data: null })
        })
    }, deps)

    return state
}