import { Meteor } from 'meteor/meteor'
import Permission from "../helper/Permission";

Meteor.methods({
    // async 'organism.add'({ name, code, taxId }) {
    //     Permission.isAdmin()
    //
    //     await DBCollections.Organism.insertAsync({
    //         code,
    //         name,
    //         taxId,
    //         isEnabled: true
    //     })
    // },
    async 'organism.add'({ name, code, taxId }) {
        Permission.checkAdmin(this.userId)

        await DBCollections.Organism.updateAsync(
            { code: code },
            {
                $set: {
                    name: name,
                    taxId: taxId,
                    isEnabled: true
                }
            },
            { upsert: true }
        )
    },
    'organism.remove'(_id) {
        Permission.checkAdmin(this.userId)

        //TODO remove all gene sets belong to this org
        DBCollections.Organism.removeAsync(_id)
    },
    async 'organism.enable'({ _id, isEnabled }) {
        Permission.checkAdmin(this.userId)

        await DBCollections.Organism.updateAsync(_id, {
            $set: { isEnabled }
        })
    },
    async 'organism.update'(organism) {
        Permission.checkAdmin(this.userId)
        await DBCollections.Organism.updateAsync(organism._id, {
            $set: organism
        })
    },
    async 'organism.getAll'() {
        return DBCollections.Organism.find({ isEnabled: true }).fetchAsync()
    },
    async 'organism.getOrganismById'({ id }) {
        return DBCollections.Organism.find({ taxId: id }).fetchAsync()
    },
    async 'organism.addOrganismsFromKegg'() {
        Permission.checkAdmin(this.userId);

        try {
            // Retrieve the list of organisms from the KEGG API
            const response = await fetch('https://rest.kegg.jp/list/organism');
            const data = await response.text();
            const lines = data.trim().split('\n');

            for (const line of lines) {
                const [_, code, organismName, taxonomy] = line.split('\t');

                // Search for the taxId using the KEGG organism page
                const keggResponse = await fetch(
                    `https://www.genome.jp/kegg-bin/show_organism?menu_type=genome_info&org=${code}`
                );
                const keggHtml = await keggResponse.text();

                // Extract the taxId from the HTML content
                const taxIdMatch = keggHtml.match(/TAX: <a href=".*id=(\d+)"/);
                if (taxIdMatch) {
                    const taxId = taxIdMatch[1];

                    // Add the organism using the organism.add method
                    await Meteor.callAsync('organism.add', {
                        name: organismName,
                        code,
                        taxId: String(taxId),
                    });

                    console.log(`Added organism: ${organismName} (${code}) with taxId: ${taxId}`);
                } else {
                    console.log(`TaxId not found for organism: ${organismName} (${code})`);
                }
            }
        } catch (error) {
            console.error('Error adding organisms from KEGG:', error);
            throw new Meteor.Error('organism-add-error', 'Failed to add organisms from KEGG');
        }
    },
    async 'organism.addOrganismsFromReactome'() {
        Permission.checkAdmin(this.userId);
        try {
            // Retrieve the list of organisms from the Reactome API
            const response = await fetch('https://reactome.org/ContentService/data/species/all');
            const data = await response.json();

            for (const organism of data) {
                const { displayName, name, taxId, abbreviation } = organism;

                // Add the organism using the organism.add method
                await Meteor.callAsync('organism.add', {
                    name: displayName,
                    code: abbreviation.toLowerCase(),
                    taxId: String(taxId)
                });

                console.log(`Added organism: ${displayName} (${abbreviation}) with taxId: ${taxId}`);
            }
        } catch (error) {
            console.error('Error adding organisms from Reactome:', error);
            throw new Meteor.Error('organism-add-error', 'Failed to add organisms from Reactome');
        }
    },
    async 'organism.getFilteredOrganisms'({databaseId}) {
        const result =  await DBCollections.Organism.rawCollection().aggregate([
            {
                $lookup: {
                    from: 'geneSets',
                    let: { organismId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$organism', '$$organismId'] },
                                        { $eq: ['$database', databaseId] }
                                    ]
                                }
                            }
                        },
                        { $limit: 1 }
                    ],
                    as: 'geneSet'
                }
            },
            {
                $match: {
                    isEnabled: true,
                    geneSet: { $size: 0 }
                }
            }
        ]).toArray();
        return result;
    }
});
