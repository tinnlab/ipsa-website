import rEval from "../rEval";
import getGEOData from "./getGEOData";
import getAnnotationData from "./getAnnotationData";
import getExpressionData from "./getExpressionData";
import ora from "./ora";
import ks from "./ks";
import wilcox from "./wilcox";
import fgsea from "./fgsea";
import fgseaExpr from "./fgsea-expr";
import ksExpr from "./ks-expr";
import wilcoxExpr from "./wilcox-expr";
import gsaExpr from "./gsa-expr";
import gseaExpr from "./gsea-expr";
import oraExpr from "./ora-expr";
import padogExpr from "./padog-expr";
import oraFC from "./ora-FC";
import DEMetaAnalysis from "./DEMetaAnalysis";
import PathwayMetaAnalysis from "./PathwayMetaAnalysis";
import ConsensusAnalysis from "./ConsensusAnalysis";

const wrapper = (fn) => (args) => rEval(fn(args))

export default new Proxy({
    getGEOData,
    getAnnotationData,
    getExpressionData,
    ora,
    wilcox,
    ks,
    fgsea,
    fgseaExpr,
    ksExpr,
    wilcoxExpr,
    gsaExpr,
    gseaExpr,
    oraExpr,
    padogExpr,
    oraFC,
    DEMetaAnalysis,
    PathwayMetaAnalysis,
    ConsensusAnalysis,
}, {
    get(target, prop) {
        return wrapper(target[prop])
    }
});
