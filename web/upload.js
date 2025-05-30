import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// 获取input目录的文件列表
async function getInputFileList() {
    try {
        const response = await fetch('/object_info');
        const data = await response.json();
        // 从 LoadImage 节点类型获取可用文件列表
        const loadImageInfo = data.LoadImage;
        if (loadImageInfo && loadImageInfo.input && loadImageInfo.input.required && loadImageInfo.input.required.image) {
            return loadImageInfo.input.required.image[0]; // 返回文件列表数组
        }
        return [];
    } catch (error) {
        console.error("获取文件列表失败:", error);
        return [];
    }
}

// 加载最新图片并复制到input文件夹
async function loadLatestImage(node, folder_type) {
    try {
        // 获取指定目录中的最新图片
        const res = await api.fetchApi(`/lg/get/latest_image?type=${folder_type}`);
        
        if (res.status === 200) {
            const item = await res.json();
            
            if (item && item.filename) {
                // 使用后端API直接复制到input文件夹
                const copyRes = await api.fetchApi(`/lg/copy_to_input`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: folder_type,
                        filename: item.filename
                    })
                });
                
                if (copyRes.status === 200) {
                    const copyData = await copyRes.json();
                    
                    if (copyData.success) {
                        // 找到图像小部件并更新值
                        const imageWidget = node.widgets.find(w => w.name === 'image');
                        
                        if (imageWidget) {
                            // 获取并更新文件列表
                            const fileList = await getInputFileList();
                            if (fileList.length > 0) {
                                imageWidget.options.values = fileList;
                            }
                            
                            // 更新图像小部件值
                            imageWidget.value = copyData.filename;
                            
                            // 通过回调更新预览图像
                            if (typeof imageWidget.callback === "function") {
                                imageWidget.callback(copyData.filename);
                            }
                            
                            // 更新画布
                            app.graph.setDirtyCanvas(true);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`加载图像失败: ${error}`);
    }
}

app.registerExtension({
    name: "Comfy.LG.LoadImageButtons",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "LG_LoadImage") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            
            const refreshTempButton = this.addWidget("button", "🔄 refresh from Temp", null, () => {
                loadLatestImage(this, "temp");
            });
            refreshTempButton.serialize = false;
            
            const refreshOutputButton = this.addWidget("button", "🔄 refresh from Output", null, () => {
                loadLatestImage(this, "output");
            });
            refreshOutputButton.serialize = false;
            
            return result;
        };
    }
});