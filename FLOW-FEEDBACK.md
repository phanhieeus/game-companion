# FLOW-FEEDBACK

Đề xuất gửi ngược lên repo template buildflow. Dự án KHÔNG được tự sửa
`_templates/` hay `flow.sh` — file này là kênh hợp lệ cho những ý đó.

- **Stage 05 (contract) giả định dự án có API HTTP.** Bảng endpoint với cột
  Method/Path/Auth không khớp dự án mà seam là hàm trong tiến trình (tool layer,
  CLI, thư viện). Template có nói "adapt the columns", nhưng ví dụ và tên cột đều
  hướng web API nên phải tự chế lại từ đầu. Đề xuất: thêm một ví dụ đã điền sẵn
  cho seam kiểu-hàm bên cạnh ví dụ endpoint.

- **Không có đường chạy flow cho MỘT tính năng trên dự án đã có sẵn.** Gate bắt
  đi hết 00→05 mới được tạo card. Với dự án đã có spec/PRD riêng, stage 00–03
  hoặc là chép lại tài liệu có sẵn (tạo nguồn sự thật thứ hai) hoặc là viết cho
  có. Đề xuất: cho phép `flow.sh next --inherit <đường dẫn>` để một stage trỏ tới
  tài liệu đã tồn tại thay vì buộc phải viết lại.

- **Gate của card không phân biệt "chưa chạy verify" với "đã chạy nhưng quên
  tick".** `flow.sh check` báo FAIL khi status=done mà còn ô trống — đúng và hữu
  ích (nó đã bắt được tôi một lần). Nhưng thông báo nên nói rõ hơn: liệt kê đúng
  ô nào chưa tick, thay vì chỉ nói "Verify has unchecked boxes".
