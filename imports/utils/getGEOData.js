

export default async (id) => {
    let fetch = Meteor.isServer ? require("node-fetch") : window.fetch

    let data = await fetch(`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${id}&targ=self&view=full&form=text`)
    data = await data.text();

    let parsedData = {
        title: data.match(/Series_title = ([^\n]+)/)?.[1],
        samples: data.match(/Series_sample_id = (GSM[0-9]+)/g)?.map(e => e.match(/GSM[0-9]+/)[0]),
        platform: data.match(/Series_platform_id = ([^\n]+)/g)?.map(e => e.trim().match(/[^\s]+$/)[0]).join(', '),
        organism: data.match(/Series_platform_organism = ([^\n]+)/)?.[1]
    }

    if (!parsedData.title) {
        throw new Error("Error when parsing data from ID: " + id)
    }

    return parsedData;
}
