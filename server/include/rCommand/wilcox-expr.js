import wilcoxKSExpr from "./wilcoxKS-expr";

export default ({ rdsFile }) => {
    return wilcoxKSExpr({ rdsFile, method: "wilcox" });
}
