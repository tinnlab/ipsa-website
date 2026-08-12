// Organism dropdown ordering (pure).
import assert from "assert";
import { sortOrganismsByName } from "../imports/utils/organismSort";

const names = (list) => list.map(o => o.name);

describe("sortOrganismsByName (organism dropdown ordering)", function () {
    it("sorts alphabetically instead of Mongo natural (KEGG import) order", function () {
        // The order the KEGG organism list actually arrives in: taxonomic, not alphabetical.
        const asImported = [
            { _id: "1", code: "hsa", name: "Homo sapiens (human)", taxId: "9606" },
            { _id: "2", code: "ath", name: "Arabidopsis thaliana", taxId: "3702" },
            { _id: "3", code: "mmu", name: "Mus musculus (mouse)", taxId: "10090" },
        ];
        assert.deepStrictEqual(names(sortOrganismsByName(asImported)), [
            "Arabidopsis thaliana",
            "Homo sapiens (human)",
            "Mus musculus (mouse)",
        ]);
    });

    it("is case-insensitive", function () {
        const list = [
            { _id: "1", name: "zebrafish" },
            { _id: "2", name: "Aardvark" },
            { _id: "3", name: "Zea mays" },
        ];
        assert.deepStrictEqual(names(sortOrganismsByName(list)), [
            "Aardvark",
            "Zea mays",
            "zebrafish",
        ]);
    });

    it("orders embedded numbers naturally, so strain 2 precedes strain 10", function () {
        const list = [
            { _id: "1", name: "E. coli strain 10" },
            { _id: "2", name: "E. coli strain 2" },
        ];
        assert.deepStrictEqual(names(sortOrganismsByName(list)), [
            "E. coli strain 2",
            "E. coli strain 10",
        ]);
    });

    it("puts docs with a missing, blank or non-string name last", function () {
        const list = [
            { _id: "1" },
            { _id: "2", name: "Bos taurus" },
            { _id: "3", name: "  " },
            { _id: "4", name: 42 },
        ];
        const sorted = sortOrganismsByName(list);
        assert.strictEqual(sorted.length, 4);
        assert.strictEqual(sorted[0].name, "Bos taurus");
    });

    it("breaks ties deterministically, whatever order minimongo returned", function () {
        const a = { _id: "b", code: "x", name: "Same name" };
        const b = { _id: "a", code: "x", name: "same name" };
        assert.deepStrictEqual(sortOrganismsByName([a, b]).map(o => o._id), ["a", "b"]);
        assert.deepStrictEqual(sortOrganismsByName([b, a]).map(o => o._id), ["a", "b"]);
    });

    it("keeps the tie-break unambiguous when code and _id could be joined the same way", function () {
        // "ab" + "c" and "a" + "bc" concatenate identically, so comparing a joined string would
        // make this pair order-dependent. code is compared before _id as its own field.
        const a = { _id: "c", code: "ab", name: "Dup" };
        const b = { _id: "bc", code: "a", name: "Dup" };
        assert.deepStrictEqual(sortOrganismsByName([a, b]).map(o => o._id), ["bc", "c"]);
        assert.deepStrictEqual(sortOrganismsByName([b, a]).map(o => o._id), ["bc", "c"]);
    });

    it("does not mutate its input", function () {
        const input = [{ _id: "1", name: "Zzz" }, { _id: "2", name: "Aaa" }];
        const before = [...input];
        sortOrganismsByName(input);
        assert.deepStrictEqual(input, before);
    });

    it("tolerates missing input", function () {
        assert.deepStrictEqual(sortOrganismsByName(undefined), []);
        assert.deepStrictEqual(sortOrganismsByName(null), []);
        assert.deepStrictEqual(sortOrganismsByName([]), []);
    });
});
