import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

function getFileItem(baseType, path) {
	try {
		let pathType = baseType;

		if (path.endsWith("[output]")) {
			pathType = "output";
			path = path.slice(0, -9);
		} else if (path.endsWith("[input]")) {
			pathType = "input";
			path = path.slice(0, -8);
		} else if (path.endsWith("[temp]")) {
			pathType = "temp";
			path = path.slice(0, -7);
		}

		const subfolder = path.substring(0, path.lastIndexOf('/'));
		const filename = path.substring(path.lastIndexOf('/') + 1);

		return {
			filename: filename,
			subfolder: subfolder,
			type: pathType
		};
	}
	catch(exception) {
		return null;
	}
}



async function loadImageFromUrl(image, node_id, v, need_to_load) {
	let item = getFileItem('temp', v);

	if(item) {
		let params = `?node_id=${node_id}&filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`;

		let res = await api.fetchApi('/impact/set/pb_id_image'+params, { cache: "no-store" });
		if(res.status == 200) {
			let pb_id = await res.text();
			if(need_to_load) {;
				image.src = api.apiURL(`/view?filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`);
			}
			return pb_id;
		}
		else {
			return `$${node_id}-0`;
		}
	}
	else {
		return `$${node_id}-0`;
	}
}

async function loadImageFromId(image, v) {
	let res = await api.fetchApi('/impact/get/pb_id_image?id='+v, { cache: "no-store" });
	if(res.status == 200) {
		let item = await res.json();
		image.src = api.apiURL(`/view?filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`);
		return true;
	}

	return false;
}

async function loadLatestImage(node, folder_type) {
	// 获取指定目录中的最新图片
	const res = await api.fetchApi(`/lg/get/latest_image?type=${folder_type}`, { cache: "no-store" });
	if (res.status == 200) {
		const item = await res.json();
		if (item && item.filename) {
			const imageWidget = node.widgets.find(w => w.name === 'image');
			if (!imageWidget) return false;
			
			// 创建映射
			const params = `?node_id=${node.id}&filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`;
			const mapRes = await api.fetchApi('/impact/set/pb_id_image' + params, { cache: "no-store" });
			
			if (mapRes.status == 200) {
				const pb_id = await mapRes.text();
				imageWidget._lock = true;
				imageWidget._value = pb_id;
				imageWidget._lock = false;
				
				// 加载新图像
				const image = new Image();
				image.src = api.apiURL(`/view?filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`);
				node._imgs = [image];
				return true;
			}
		}
	}
	return false;
}

app.registerExtension({
    name: "Comfy.LG.CachePreview",
    
    nodeCreated(node, app) {
        if (node.comfyClass !== "CachePreviewBridge") return;
        
        let imageWidget = node.widgets.find(w => w.name === 'image');
        node._imgs = [new Image()];
        node.imageIndex = 0;
        
        // 添加从temp文件夹刷新按钮
        const refreshTempButton = node.addWidget("button", "🔄 refresh from Temp", null, () => {
            loadLatestImage(node, "temp").then(success => {
                if (success) {
                    app.graph.setDirtyCanvas(true);
                }
            });
        });
        refreshTempButton.serialize = false;
        
        // 添加从output文件夹刷新按钮
        const refreshOutputButton = node.addWidget("button", "🔄 refresh from Output", null, () => {
            loadLatestImage(node, "output").then(success => {
                if (success) {
                    app.graph.setDirtyCanvas(true);
                }
            });
        });
        refreshOutputButton.serialize = false;
        
        // 添加粘贴功能
        node.pasteFile = async function(file) {
            const uploadWidget = node.widgets.find(w => w.name === 'image');
            if (!uploadWidget) return;
            
            // 上传到 clipspace 目录
            const fileName = `clipspace_${Date.now()}.png`;
            const formData = new FormData();
            formData.append('image', file, fileName);
            formData.append('type', 'input');
            formData.append('subfolder', 'clipspace');
            
            try {
                const resp = await fetch('/upload/image', {
                    method: 'POST',
                    body: formData,
                });
                
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.name) {
                        // 创建一个临时的 item 对象
                        const item = {
                            filename: data.name,
                            type: 'input',
                            subfolder: 'clipspace'
                        };
                        
                        // 使用 set/pb_id_image 创建映射
                        const params = `?node_id=${node.id}&filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`;
                        const res = await api.fetchApi('/impact/set/pb_id_image'+params, { cache: "no-store" });
                        
                        if (res.status == 200) {
                            const pb_id = await res.text();
                            imageWidget._lock = true;
                            imageWidget._value = pb_id;
                            imageWidget._lock = false;
                            
                            // 加载图像
                            const image = new Image();
                            if (await loadImageFromId(image, pb_id)) {
                                node._imgs = [image];
                                app.graph.setDirtyCanvas(true);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Failed to upload file:", error);
            }
        };
        
        // 简化后的 value 属性重写
        Object.defineProperty(imageWidget, 'value', {
            async set(v) {
                if (imageWidget._lock) return;
                
                const stackTrace = new Error().stack;
                if (stackTrace.includes('presetText.js')) return;
                
                var image = new Image();
                
                // 处理节点反馈的图像
                if (v && v.constructor === String && v.startsWith('$')) {
                    let need_to_load = node._imgs[0].src === '';
                    if (await loadImageFromId(image, v, need_to_load)) {
                        imageWidget._value = v;
                        if (node._imgs[0].src === '') {
                            node._imgs = [image];
                        }
                    } else {
                        imageWidget._value = `$${node.id}-0`;
                    }
                } 
                // 处理从剪贴板导入的图像
                else {
                    imageWidget._lock = true;
                    imageWidget._value = await loadImageFromUrl(image, node.id, v, false);
                    imageWidget._lock = false;
                }
            },
            get() {
                if (imageWidget._value === undefined) {
                    imageWidget._value = `$${node.id}-0`;
                }
                return imageWidget._value;
            }
        });
        
        Object.defineProperty(node, 'imgs', {
            set(v) {
                const stackTrace = new Error().stack;
                if (!v || v.length === 0) return;
                
                if (stackTrace.includes('pasteFromClipspace')) {
                    // 检查是否来自ComfyUI系统的clipspace
                    if (v[0].src && v[0].src.includes('/api/view')) {
                        (async () => {
                            try {
                                // 从原始图像创建 blob
                                const response = await fetch(v[0].src);
                                const blob = await response.blob();
                                
                                // 使用相同的命名方式
                                const fileName = `clipspace_${Date.now()}.png`;
                                const formData = new FormData();
                                formData.append('image', blob, fileName);
                                formData.append('type', 'input');
                                formData.append('subfolder', 'clipspace');
                                
                                // 上传到 clipspace 目录
                                const resp = await fetch('/upload/image', {
                                    method: 'POST',
                                    body: formData,
                                });
                                
                                if (resp.ok) {
                                    const data = await resp.json();
                                    if (data.name) {
                                        // 创建临时 item 对象
                                        const item = {
                                            filename: data.name,
                                            type: 'input',
                                            subfolder: 'clipspace'
                                        };
                                        
                                        // 创建映射
                                        const params = `?node_id=${node.id}&filename=${item.filename}&type=${item.type}&subfolder=${item.subfolder}`;
                                        const res = await api.fetchApi('/impact/set/pb_id_image'+params, { cache: "no-store" });
                                        
                                        if (res.status == 200) {
                                            const pb_id = await res.text();
                                            imageWidget._lock = true;
                                            imageWidget._value = pb_id;
                                            imageWidget._lock = false;
                                            
                                            // 加载新图像
                                            const image = new Image();
                                            if (await loadImageFromId(image, pb_id)) {
                                                node._imgs = [image];
                                                app.graph.setDirtyCanvas(true);
                                            }
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error("Failed to process clipspace paste:", error);
                            }
                        })();
                    } else {
                        // 原有的处理逻辑
                        let sp = new URLSearchParams(v[0].src.split("?")[1]);
                        let str = "";
                        if (sp.get('subfolder')) {
                            str += sp.get('subfolder') + '/';
                        }
                        str += `${sp.get("filename")} [${sp.get("type")}]`;
                        
                        imageWidget.value = str;
                        node._imgs = v;
                    }
                    return;
                }
                
                node._imgs = v;
            },
            get() {
                return node._imgs;
            }
        });
    }
});