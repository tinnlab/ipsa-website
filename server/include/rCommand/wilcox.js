import wilcoxKS from "./wilcoxKS";

export default ({ rdsFile }) => {
    return wilcoxKS({ rdsFile, method: "wilcox" });
}
