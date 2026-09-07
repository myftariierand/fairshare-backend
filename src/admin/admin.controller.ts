import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

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

  @Patch('users/:id')
  updateUser(
    @Param() { id }: { id: string },
    @Body() { password }: { password: string },
  ) {
    return this.adminService.updateUser(id, password);
  }

  @Delete('users/:id')
  deleteUser(@Param() { id }: { id: string }) {
    return this.adminService.deleteUser(id);
  }

  @Get('bugs')
  getBugReports() {
    return this.adminService.getBugs();
  }
}
