import { useState, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'

export default function useSubscription(subscriptionName, args, deps) {
    useEffect(() => {
        const subscription = Meteor.subscribe(subscriptionName, args)
        return () => {
            // subscription.stop()
        }
    }, deps)
}