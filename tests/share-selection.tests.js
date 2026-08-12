import assert from "assert";
import {
    resolveShareSelection,
    shareSelectionNames,
    validateShareSelection,
} from "../imports/utils/shareSelection";

// Three analyses and one meta-analysis computed from all three. This is the shape where the defect bit:
// sharing the whole study handed over the analyses and silently left the meta-analysis behind.
const makeStudy = () => ({
    analyses: [
        {id: "a1", name: "Analysis A"},
        {id: "a2", name: "Analysis B"},
        {id: "a3", name: "Analysis C"},
    ],
    metaAnalyses: [
        {
            id: "m1",
            name: "Meta X",
            geneLevel: {selectedAnalyses: ["a1", "a2"]},
            pathwayLevel: {selectedAnalyses: ["a1", "a2", "a3"]},
        },
    ],
});

describe("resolveShareSelection (what the owner is handing over)", function () {
    it("includes a meta-analysis whose analyses are ALL selected, even unticked", function () {
        const out = resolveShareSelection(makeStudy(), ["a1", "a2", "a3"]);
        assert.deepStrictEqual(out.analysisIds, ["a1", "a2", "a3"]);
        assert.deepStrictEqual(out.metaIds, ["m1"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2", "a3", "m1"]);
        // Reported so the modal can say the meta is riding along rather than surprising the owner.
        assert.deepStrictEqual(out.autoIncludedMeta, [{id: "m1", name: "Meta X"}]);
        assert.deepStrictEqual(out.droppedMeta, []);
    });

    // This is the bug the whole change exists for: accepting the default used to ship zero metas.
    it("carries the meta when the whole study is selected", function () {
        const out = resolveShareSelection(makeStudy(), ["a1", "a2", "a3", "m1"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2", "a3", "m1"]);
        // Ticked explicitly, so it is not an auto-inclusion worth announcing.
        assert.deepStrictEqual(out.autoIncludedMeta, []);
    });

    it("drops a requested meta whose analyses are incomplete, and names what is missing", function () {
        const out = resolveShareSelection(makeStudy(), ["a1", "a2", "m1"]);
        assert.deepStrictEqual(out.metaIds, []);
        assert.deepStrictEqual(out.allIds, ["a1", "a2"]);
        assert.strictEqual(out.droppedMeta.length, 1);
        assert.deepStrictEqual(out.droppedMeta[0].missingSourceIds, ["a3"]);
        assert.deepStrictEqual(out.droppedMeta[0].missingSourceNames, ["Analysis C"]);
        assert.deepStrictEqual(out.droppedMeta[0].unavailableSourceIds, []);
    });

    // Adding the missing analyses is what the modal's button does; the meta then travels.
    it("includes the meta once the missing analysis is added", function () {
        const first = resolveShareSelection(makeStudy(), ["a1", "a2", "m1"]);
        const repaired = [...new Set(["a1", "a2", "m1", ...first.droppedMeta[0].missingSourceIds])];
        assert.deepStrictEqual(resolveShareSelection(makeStudy(), repaired).metaIds, ["m1"]);
    });

    it("stays quiet about a meta the owner never asked for", function () {
        const out = resolveShareSelection(makeStudy(), ["a1", "a2"]);
        assert.deepStrictEqual(out.droppedMeta, []);
        assert.deepStrictEqual(out.allIds, ["a1", "a2"]);
    });

    // A source that is not among the study's analyses can never be ticked back, so the modal must not
    // offer to add it. Kept apart from the merely-unselected ones for exactly that reason.
    it("separates unavailable sources from merely unselected ones", function () {
        const session = makeStudy();
        session.analyses = session.analyses.filter((entry) => entry.id !== "a3");
        const out = resolveShareSelection(session, ["a1", "a2", "m1"]);
        assert.deepStrictEqual(out.droppedMeta[0].missingSourceIds, []);
        assert.deepStrictEqual(out.droppedMeta[0].unavailableSourceIds, ["a3"]);
    });

    it("drops a meta with no recorded sources rather than sharing it on faith", function () {
        const session = makeStudy();
        session.metaAnalyses = [{id: "m1", name: "Meta X"}];
        const out = resolveShareSelection(session, ["a1", "a2", "a3", "m1"]);
        assert.deepStrictEqual(out.metaIds, []);
        assert.deepStrictEqual(out.droppedMeta[0].missingSourceIds, []);
        assert.deepStrictEqual(out.droppedMeta[0].unavailableSourceIds, []);
    });

    // A meta id must never be mistaken for a source: it is not in the clone's analysis map, so it would
    // reach remapMetaAnalysisEntry as an id that cannot be rewritten.
    it("never treats a meta id as another meta's source", function () {
        const session = makeStudy();
        session.metaAnalyses.push({
            id: "m2",
            name: "Meta of meta",
            pathwayLevel: {selectedAnalyses: ["m1"]},
        });
        const out = resolveShareSelection(session, ["a1", "a2", "a3", "m1", "m2"]);
        assert.deepStrictEqual(out.metaIds, ["m1"]);
        assert.strictEqual(out.droppedMeta.length, 1);
        assert.strictEqual(out.droppedMeta[0].id, "m2");
    });

    it("ignores ids that name nothing in the study", function () {
        const out = resolveShareSelection(makeStudy(), ["a1", "nope", "a2", "a3"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2", "a3", "m1"]);
    });

    it("leaves a study with no meta-analyses exactly as before", function () {
        const session = {analyses: [{id: "a1", name: "A"}, {id: "a2", name: "B"}]};
        const out = resolveShareSelection(session, ["a1", "a2"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2"]);
        assert.deepStrictEqual(out.metaIds, []);
        assert.deepStrictEqual(out.autoIncludedMeta, []);
        assert.deepStrictEqual(out.droppedMeta, []);
    });

    it("tolerates a missing session and a missing selection", function () {
        assert.deepStrictEqual(resolveShareSelection(null, ["a1"]).allIds, []);
        assert.deepStrictEqual(resolveShareSelection(makeStudy(), undefined).allIds, []);
        assert.deepStrictEqual(resolveShareSelection({}, ["a1"]).allIds, []);
    });

    // selectedAnalyses is stored from a method that validates only the meta's id, so a malformed one is
    // reachable. This function runs in the share modal's RENDER — a throw here white-screens the owner's
    // own modal — and in share.create.
    it("survives a malformed meta-analysis entry", function () {
        const session = makeStudy();
        session.metaAnalyses = [
            {id: "m1", name: "Junk", pathwayLevel: {selectedAnalyses: {a: 1}}},
            {id: "m2", name: "Also junk", geneLevel: {selectedAnalyses: "a1"}},
        ];
        const out = resolveShareSelection(session, ["a1", "a2", "a3", "m1", "m2"]);
        assert.deepStrictEqual(out.metaIds, []);
        assert.deepStrictEqual(out.allIds, ["a1", "a2", "a3"]);
        assert.deepStrictEqual(out.droppedMeta.map((meta) => meta.id), ["m1", "m2"]);
    });
});

describe("validateShareSelection (what a stored link still covers)", function () {
    // THE point of having a second function. A link minted over A, B, C and Meta X must not start
    // handing out a meta-analysis computed afterwards from the same three analyses: the owner never saw
    // it in the modal and never agreed to share it.
    it("NEVER adds a meta-analysis created after the link was minted", function () {
        const session = makeStudy();
        session.metaAnalyses.push({
            id: "m2",
            name: "Meta computed later",
            pathwayLevel: {selectedAnalyses: ["a1", "a2", "a3"]},
        });
        const out = validateShareSelection(session, ["a1", "a2", "a3", "m1"]);
        assert.deepStrictEqual(out.metaIds, ["m1"]);
        assert.strictEqual(out.allIds.includes("m2"), false);
    });

    it("never returns anything outside the stored list", function () {
        const out = validateShareSelection(makeStudy(), ["a1", "a2"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2"]);
    });

    it("drops a stored meta once one of its analyses is deleted from the study", function () {
        const session = makeStudy();
        session.analyses = session.analyses.filter((entry) => entry.id !== "a3");
        const out = validateShareSelection(session, ["a1", "a2", "a3", "m1"]);
        assert.deepStrictEqual(out.analysisIds, ["a1", "a2"]);
        assert.deepStrictEqual(out.metaIds, []);
        assert.deepStrictEqual(out.droppedMeta, [{id: "m1", name: "Meta X"}]);
    });

    it("drops a stored meta whose analyses were not stored with it", function () {
        // A link that named only the meta — possible on a record written before this rule existed.
        assert.deepStrictEqual(validateShareSelection(makeStudy(), ["m1"]).allIds, []);
    });

    it("is idempotent", function () {
        const once = validateShareSelection(makeStudy(), ["a1", "a2", "a3", "m1"]);
        const twice = validateShareSelection(makeStudy(), once.allIds);
        assert.deepStrictEqual(twice.allIds, once.allIds);
    });

    it("tolerates a missing session and a missing stored list", function () {
        assert.deepStrictEqual(validateShareSelection(null, ["a1"]).allIds, []);
        assert.deepStrictEqual(validateShareSelection(makeStudy(), undefined).allIds, []);
    });

    // share.preview is NOT inside a try/catch, so a throw here is a 500 that makes the link permanently
    // unopenable rather than a meta being dropped.
    it("survives a malformed meta-analysis entry", function () {
        const session = makeStudy();
        session.metaAnalyses = [{id: "m1", name: "Junk", pathwayLevel: {selectedAnalyses: {a: 1}}}];
        const out = validateShareSelection(session, ["a1", "a2", "a3", "m1"]);
        assert.deepStrictEqual(out.allIds, ["a1", "a2", "a3"]);
        assert.deepStrictEqual(out.droppedMeta, [{id: "m1", name: "Junk"}]);
    });
});

// The property that makes the modal, the landing page and the import three views of one answer: what
// share.create stores is exactly what share.preview promises and share.import delivers.
describe("resolve and validate agree at a fixed study state", function () {
    const cases = [
        ["a1", "a2", "a3", "m1"],
        ["a1", "a2", "a3"],
        ["a1", "a2", "m1"],
        ["a1"],
        [],
    ];

    for (const requested of cases) {
        it(`agrees for [${requested.join(", ")}]`, function () {
            const resolved = resolveShareSelection(makeStudy(), requested);
            const validated = validateShareSelection(makeStudy(), resolved.allIds);
            assert.deepStrictEqual(validated.allIds, resolved.allIds);
            assert.deepStrictEqual(validated.droppedMeta, []);
        });
    }
});

describe("shareSelectionNames", function () {
    it("splits the names by kind so the recipient is told what is arriving", function () {
        const resolved = resolveShareSelection(makeStudy(), ["a1", "a2", "a3"]);
        assert.deepStrictEqual(shareSelectionNames(makeStudy(), resolved), {
            analysisNames: ["Analysis A", "Analysis B", "Analysis C"],
            metaAnalysisNames: ["Meta X"],
        });
    });

    it("falls back to the id for an unnamed entry and skips ids the study lost", function () {
        const session = {analyses: [{id: "a1"}]};
        assert.deepStrictEqual(shareSelectionNames(session, {analysisIds: ["a1", "gone"], metaIds: []}), {
            analysisNames: ["a1"],
            metaAnalysisNames: [],
        });
    });

    // Its two siblings in this module tolerate anything; it should not be the one that throws.
    it("tolerates being called with no selection", function () {
        assert.deepStrictEqual(shareSelectionNames(makeStudy()), {
            analysisNames: [],
            metaAnalysisNames: [],
        });
        assert.deepStrictEqual(shareSelectionNames(null, {}), {analysisNames: [], metaAnalysisNames: []});
    });
});

// A study is not supposed to list one id twice, but nothing in this module stops it, and a duplicate
// would make the recipient's "2 analyses" count a lie about what they are receiving.
//
// Scope: this covers the ID LIST only. It says nothing about what cloneStudy would do with such a study
// — there the id would key both analysisIdMap and metaIdMap and the rows would land under the wrong one.
// That is unreachable because assertAnalysisIdIsNew enforces global uniqueness across BOTH arrays, and
// it is not what these assertions establish.
describe("a malformed study cannot produce a duplicated id list", function () {
    it("de-duplicates a repeated analysis entry", function () {
        const session = {analyses: [{id: "a1", name: "A"}, {id: "a1", name: "A again"}]};
        assert.deepStrictEqual(resolveShareSelection(session, ["a1"]).allIds, ["a1"]);
        assert.deepStrictEqual(validateShareSelection(session, ["a1"]).allIds, ["a1"]);
    });

    it("never lists one id as both an analysis and a meta-analysis", function () {
        const session = {
            analyses: [{id: "a1", name: "A"}],
            metaAnalyses: [{id: "a1", name: "A", pathwayLevel: {selectedAnalyses: ["a1"]}}],
        };
        assert.deepStrictEqual(resolveShareSelection(session, ["a1"]).allIds, ["a1"]);
        assert.deepStrictEqual(validateShareSelection(session, ["a1"]).allIds, ["a1"]);
    });
});
