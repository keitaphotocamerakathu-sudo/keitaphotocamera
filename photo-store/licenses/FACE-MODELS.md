# Face search model notices

This release uses locally executed YuNet (MIT, Shiqi Yu) and SFace (Apache-2.0, contributed by Yaoyao Zhong; OpenCV Zoo conversion). ONNX Runtime Web 1.21.0 is MIT licensed. No recognition API subscription or paid compute is added.

Upstream: https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models

- Detector: face_detection_yunet/face_detection_yunet_2023mar.onnx; SHA-256 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4.
- Recognizer: face_recognition_sface/face_recognition_sface_2021dec.onnx; SHA-256 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79.
- License texts: [YuNet](YuNet-LICENSE.txt), [SFace](SFace-LICENSE.txt), [ONNX Runtime](https://github.com/microsoft/onnxruntime/blob/v1.21.0/LICENSE).

KEITA implements its own browser adapter following OpenCV 4.10 FaceDetectorYN/FaceRecognizerSF preprocessing: BGR detector tensors, five-point similarity alignment, RGB [0,255] SFace tensors, and L2-normalized embeddings. No upstream accuracy number is a measurement of this store's race photos.

Do not mix sface-yunet-v1 embeddings with face-api/FaceX. Existing engines are retained during reindexing. The browser downloads roughly 39 MB of models on first use; normal HTTP caching is used. Model or image data is never put in localStorage/IndexedDB by this adapter. Existing hosting/database quotas still apply.

