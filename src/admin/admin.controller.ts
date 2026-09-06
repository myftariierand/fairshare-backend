import { Controller, Get, UseGuards } from '@nestjs/common';

import { AdminService } from 'src/admin/admin.service';
import { AdminOnlyGuard } from 'src/admin/role.guard';

@Controller('admin')
@UseGuards(AdminOnlyGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('groups')
  getGroups() {
    return this.adminService.getGroups();
  }

  @Get('activites')
  getActivity() {
    return this.adminService.getActivities();
  }

  @Get('users')
  getUsers() {
    return this.adminService.getUsers();
  }

  @Get('bugs')
  getBugReports() {
    return this.adminService.getBugs();
  }
}
